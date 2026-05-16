import mysql.connector
import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

# Load encryption key
ENCRYPTION_KEY_FILE = 'encryption.key'
if not os.path.exists(ENCRYPTION_KEY_FILE):
    print("Encryption key not found. Migration aborted.")
    exit(1)

with open(ENCRYPTION_KEY_FILE, 'rb') as f:
    FERNET_KEY = f.read().strip()
cipher = Fernet(FERNET_KEY)

def encrypt(value):
    if value is None: return None
    return cipher.encrypt(str(value).encode('utf-8')).decode('utf-8')

def is_encrypted(value):
    if value is None: return False
    try:
        cipher.decrypt(str(value).encode('utf-8'))
        return True
    except:
        return False

def migrate():
    db = mysql.connector.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        user=os.getenv('DB_USER', 'root'),
        password=os.getenv('DB_PASS', ''),
        database=os.getenv('DB_NAME', 'nutripulse')
    )
    cursor = db.cursor(dictionary=True)
    
    # 1. Migrate Users
    print("Migrating Users table...")
    cursor.execute("SELECT id, name, email, age, height, weight FROM users")
    users = cursor.fetchall()
    for u in users:
        updates = []
        params = []
        
        if u['name'] and not is_encrypted(u['name']):
            updates.append("name = %s")
            params.append(encrypt(u['name']))
            
        if u['email'] and not is_encrypted(u['email']):
            updates.append("email = %s")
            params.append(encrypt(u['email']))
            
        if u['age'] is not None:
            updates.append("age_enc = %s")
            params.append(encrypt(u['age']))
            
        if u['height'] is not None:
            updates.append("height_enc = %s")
            params.append(encrypt(u['height']))
            
        if u['weight'] is not None:
            updates.append("weight_enc = %s")
            params.append(encrypt(u['weight']))
            
        if updates:
            sql = f"UPDATE users SET {', '.join(updates)} WHERE id = %s"
            params.append(u['id'])
            cursor.execute(sql, tuple(params))
            
    # 2. Migrate Meals
    print("Migrating Meals table...")
    cursor.execute("SELECT id, food_name, calories FROM meals")
    meals = cursor.fetchall()
    for m in meals:
        updates = []
        params = []
        
        if m['food_name'] and not is_encrypted(m['food_name']):
            updates.append("food_name = %s")
            params.append(encrypt(m['food_name']))
            
        if m['calories'] is not None:
            updates.append("calories_enc = %s")
            params.append(encrypt(m['calories']))
            
        if updates:
            sql = f"UPDATE meals SET {', '.join(updates)} WHERE id = %s"
            params.append(m['id'])
            cursor.execute(sql, tuple(params))

    db.commit()
    print("Migration complete.")
    db.close()

if __name__ == "__main__":
    migrate()
