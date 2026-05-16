import mysql.connector
import os
from dotenv import load_dotenv

load_dotenv()

def check_columns():
    db = mysql.connector.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        user=os.getenv('DB_USER', 'root'),
        password=os.getenv('DB_PASS', ''),
        database=os.getenv('DB_NAME', 'nutripulse')
    )
    cursor = db.cursor()
    
    tables = ['users', 'meals']
    for table in tables:
        print(f"\n--- Columns in {table} ---")
        cursor.execute(f"DESCRIBE {table}")
        for col in cursor.fetchall():
            print(col[0])
            
    db.close()

if __name__ == "__main__":
    check_columns()
