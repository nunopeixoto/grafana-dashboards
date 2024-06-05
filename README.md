# grafana-dashboards

## Purpose
- Plot visualizations on Grafana against a MySQL DB


## Setup
### Automated
- Install docker
- Run `docker compose up -d` to create a Grafana and MySQL instance
- Add data to MySQL (see src/helpers/import-gsheets-mysql/README.md)
- Go to Grafana http://localhost:3001/login and import the dashboards with th MySQL data source

### Manual
- The Grafana dashboards connect to a MySQL instance
- The DB should contain the table that looks like this:
```mysql
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