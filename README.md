# grafana-dashboards

## Purpose
- Plot visualizations on Grafana against a MariaDB


## Setup
### Automated
- Install docker
- Run `docker compose up -d` to create a Grafana and MariaDB instance
- Add data to MariaDB (see src/helpers/import-gsheets-MariaDB/README.md)
- To determine what is your MariaDB address, run `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' mariadb`
- Go to Grafana http://localhost:3001/login and import the dashboards with th MariaDB data source

### Manual
- The Grafana dashboards connect to a MariaDB instance
- The DB should contain one table per expense sheet (`transactions` for the household, `personal_expenses` for the personal one), each looking like this:
```sql
CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    date DATE,
    description VARCHAR(255),
    debit DECIMAL(10, 2),
    credit DECIMAL(10, 2),
    category VARCHAR(255),
    subcategory VARCHAR(255),
    note TEXT
);
```

## Dashboards
- `src/dashboards/household.json` - shared household expenses, reads the `transactions` table
- `src/dashboards/personal.json` - personal expenses (hobbies and other personal spending), reads the `personal_expenses` table
