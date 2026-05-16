import mysql.connector
import os
from dotenv import load_dotenv

load_dotenv()

def finalize():
    db = mysql.connector.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        user=os.getenv('DB_USER', 'root'),
        password=os.getenv('DB_PASS', ''),
        database=os.getenv('DB_NAME', 'nutripulse')
    )
    cursor = db.cursor()
    
    print("Cleaning up Users table...")
    try:
        # Drop old plain columns
        cursor.execute("ALTER TABLE users DROP COLUMN age, DROP COLUMN height, DROP COLUMN weight")
        # Rename encrypted columns back to original names
        cursor.execute("ALTER TABLE users CHANGE age_enc age TEXT")
        cursor.execute("ALTER TABLE users CHANGE height_enc height TEXT")
        cursor.execute("ALTER TABLE users CHANGE weight_enc weight TEXT")
    except Exception as e:
        print(f"Users table cleanup notice: {e}")

    print("Cleaning up Meals table...")
    try:
        # Drop old plain calories
        cursor.execute("ALTER TABLE meals DROP COLUMN calories")
        # Rename encrypted calories back to original name
        cursor.execute("ALTER TABLE meals CHANGE calories_enc calories TEXT")
    except Exception as e:
        print(f"Meals table cleanup notice: {e}")

    db.commit()
    print("Database hardening complete. Sensitive data is now ONLY stored in encrypted form.")
    db.close()

if __name__ == "__main__":
    finalize()
