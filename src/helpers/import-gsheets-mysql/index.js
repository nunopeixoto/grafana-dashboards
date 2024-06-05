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
const range = process.env.SPREADSHEET_RANGE; // Assuming headers are in the first row

async function fetchGoogleSheetData() {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return response.data.values;
}

// MySQL setup
const mysqlConfig = {
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
};

async function syncDataToMySQL(data) {
    const connection = await mysql.createConnection(mysqlConfig);

    // Truncate table
    const truncateTableQuery = `
    TRUNCATE TABLE transactions;
    `;
    await connection.execute(truncateTableQuery);

    // Create table if not exists
    const createTableQuery = `
    CREATE TABLE IF NOT EXISTS transactions (
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

    // Insert data into the table
    const insertQuery = `
    INSERT INTO transactions (date, description, debit, credit, category, subcategory, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const insertData = data.map((row) => {
        return [
            row[0] ? new Date(row[0]) : null,   // date
            row[1] || null,                     // description
            parseFloat(row[2].replace(',', '.')) || null,  // debit
            parseFloat(row[3].replace(',', '.')) || null,  // credit
            row[4] || null,                     // category
            row[5] || null,                     // subcategory
            row[6] || null                      // note
        ];
    });

    for (const rowData of insertData) {
        await connection.execute(insertQuery, rowData);
    }

    await connection.end();
}

(async () => {
    try {
        const data = await fetchGoogleSheetData();
        await syncDataToMySQL(data);
        console.log('Data synced successfully');
    } catch (error) {
        console.error('Error syncing data:', error);
    }
})();
