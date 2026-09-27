const { google } = require('googleapis');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Load the service account key JSON file
const keyFilePath = path.join(__dirname, 'credentials.json');
const keyFile = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));

// Configure a JWT auth client
const jwtClient = new google.auth.JWT(
    keyFile.client_email,
    null,
    keyFile.private_key,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
);

// Google Sheets setup
const sheets = google.sheets({ version: 'v4', auth: jwtClient });

// Replace with your Google Sheet ID and range
const spreadsheetId = process.env.SPREADSHEET_ID;

// Each import is a sheet range (including the header row) synced into its own
// table. Columns are matched by header name, because the sheets do not share a
// column layout: the personal one has a blank column between debit and credit.
// SPREADSHEET_RANGE/TARGET_TABLE cover the shared household sheet, the
// PERSONAL_* pair covers the personal one. An import is skipped when its
// range is not configured.
const imports = [
    { range: process.env.SPREADSHEET_RANGE, table: process.env.TARGET_TABLE || 'transactions' },
    { range: process.env.PERSONAL_SPREADSHEET_RANGE, table: process.env.PERSONAL_TARGET_TABLE || 'personal_expenses' }
].filter(({ range }) => range);

// Table names are interpolated into DDL, so only allow plain identifiers
function assertSafeTableName(table) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
        throw new Error(`Invalid table name: ${table}`);
    }
}

// The columns we import, in DB order
const COLUMNS = ['date', 'description', 'debit', 'credit', 'category', 'subcategory', 'note'];

// Map each wanted column to its index in the sheet, using the header row
function mapHeaderColumns(headerRow, range) {
    const normalized = headerRow.map((cell) => String(cell ?? '').trim().toLowerCase());
    const indexes = {};
    for (const column of COLUMNS) {
        const index = normalized.indexOf(column);
        if (index === -1) {
            throw new Error(`Range "${range}" has no "${column}" column, found: ${JSON.stringify(headerRow)}`);
        }
        indexes[column] = index;
    }
    return indexes;
}

// The sheets use DD/MM/YYYY or YYYY/MM/DD, neither of which new Date() reads
// reliably (it treats DD/MM/YYYY as US MM/DD/YYYY), so parse them explicitly
function parseSheetDate(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;

    let match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (match) {
        const [, year, month, day] = match;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (match) {
        const [, day, month, year] = match;
        if (Number(month) > 12) {
            throw new Error(`Ambiguous date "${text}": month ${month} is out of range`);
        }
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    throw new Error(`Unrecognized date format: "${text}"`);
}

// Amounts are written with either a comma or a dot as the decimal separator
function parseAmount(value) {
    const text = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
    if (!text) return null;
    const amount = parseFloat(text);
    return Number.isNaN(amount) ? null : amount;
}

async function fetchGoogleSheetData(range) {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return response.data.values || [];
}

// MySQL setup
const mysqlConfig = {
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
};

async function syncDataToMySQL(connection, data, table, range) {
    // Create table if not exists
    const createTableQuery = `
    CREATE TABLE IF NOT EXISTS ${table} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        date DATE,
        description VARCHAR(255),
        debit DECIMAL(10,2),
        credit DECIMAL(10,2),
        category VARCHAR(255),
        subcategory VARCHAR(255),
        note TEXT
    )
    `;
    await connection.execute(createTableQuery);

    // Truncate table
    const truncateTableQuery = `TRUNCATE TABLE ${table};`;
    await connection.execute(truncateTableQuery);

    // Insert data into the table
    const insertQuery = `
    INSERT INTO ${table} (date, description, debit, credit, category, subcategory, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    // The first row is the header, and it tells us where each column sits
    const [headerRow, ...dataRows] = data;
    if (!headerRow) {
        throw new Error('Range returned no rows, expected a header row');
    }
    const columnIndexes = mapHeaderColumns(headerRow, range);

    // The sheet is manually filled, so stop at the first fully empty row
    const emptyRowIndex = dataRows.findIndex((row) => !row || row.every((cell) => !String(cell ?? '').trim()));
    const rows = emptyRowIndex === -1 ? dataRows : dataRows.slice(0, emptyRowIndex);
    if (emptyRowIndex !== -1) {
        console.log(`Empty row found at sheet row ${emptyRowIndex + 2}, stopping there`);
    }
    console.log(`Last expense date: ${rows[rows.length - 1]?.[columnIndexes.date]}`);

    const insertData = rows.map((row, index) => {
        const cell = (column) => row[columnIndexes[column]];
        try {
            return [
                parseSheetDate(cell('date')),
                cell('description') || null,
                parseAmount(cell('debit')),
                parseAmount(cell('credit')),
                cell('category') || null,
                cell('subcategory') || null,
                cell('note') || null
            ];
        } catch (error) {
            // +2: sheet rows are 1-based and the header row is excluded here
            console.error(`Row ${index + 2} is invalid: ${error.message}`);
            console.error('  content:', JSON.stringify(row));
            throw error;
        }
    });

    for (const rowData of insertData) {
        await connection.execute(insertQuery, rowData);
    }
    console.log(`Inserted ${insertData.length} rows (${data.length} fetched from the sheet)`);

    const [[{ total }]] = await connection.query(`SELECT COUNT(*) AS total FROM ${table}`);
    console.log(`Total transactions in ${table}: ${total}`);
}

(async () => {
    if (imports.length === 0) {
        console.error('No imports configured, set SPREADSHEET_RANGE and/or PERSONAL_SPREADSHEET_RANGE');
        process.exitCode = 1;
        return;
    }

    let connection;
    try {
        imports.forEach(({ table }) => assertSafeTableName(table));
        connection = await mysql.createConnection(mysqlConfig);
        for (const { range, table } of imports) {
            console.log(`\nSyncing "${range}" into ${table}`);
            const data = await fetchGoogleSheetData(range);
            await syncDataToMySQL(connection, data, table, range);
        }
        console.log('\nData synced successfully');
    } catch (error) {
        console.error('Error syncing data:', error);
        process.exitCode = 1;
    } finally {
        if (connection) {
            await connection.end();
        }
    }
})();
