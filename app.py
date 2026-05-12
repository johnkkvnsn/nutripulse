"""
══════════════════════════════════════════
 NutriPulse — REST API  (Flask + MySQL)
 All business logic lives server-side.
══════════════════════════════════════════
"""

from flask import Flask, request, jsonify, send_from_directory, g
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
from datetime import datetime, date, timedelta
from decimal import Decimal
import mysql.connector
import jwt
import os
import base64
import tempfile
import uuid
import json
import re
from inference_sdk import InferenceHTTPClient
import firebase_admin
from firebase_admin import credentials, messaging as fcm_messaging

# ─── FIREBASE ADMIN INIT ────────────────────
cred = credentials.Certificate('firebase-service-account.json')
firebase_admin.initialize_app(cred)


# ─── CONFIG ──────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

SECRET_KEY = os.environ.get('JWT_SECRET', 'nutripulse-dev-secret-change-in-prod')
app.config['SECRET_KEY'] = SECRET_KEY

DB_CONFIG = {
    'host':     os.environ.get('DB_HOST',     'localhost'),
    'port':     int(os.environ.get('DB_PORT', 3306)),
    'user':     os.environ.get('DB_USER',     'root'),
    'password': os.environ.get('DB_PASSWORD', ''),        # XAMPP default
    'database': os.environ.get('DB_NAME',     'nutripulse'),
    'charset':  'utf8mb4',
    'autocommit': False,
}


# ─── DATABASE HELPERS ────────────────────────
def get_db():
    """Get a MySQL connection for the current request."""
    if 'db' not in g:
        g.db = mysql.connector.connect(**DB_CONFIG)
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def db_query(sql, params=None, one=False, commit=False):
    """Run a query and return results as list of dicts."""
    conn = get_db()
    cur = conn.cursor(dictionary=True)
    cur.execute(sql, params or ())
    if commit:
        conn.commit()
        last_id = cur.lastrowid
        cur.close()
        return last_id
    rows = cur.fetchall()
    cur.close()
    # Convert Decimal/date objects to JSON-friendly types
    for row in rows:
        for k, v in row.items():
            if isinstance(v, Decimal):
                row[k] = float(v)
            elif isinstance(v, (date, datetime)):
                row[k] = v.isoformat()
    return rows[0] if one and rows else (None if one else rows)


# ─── JWT AUTH ────────────────────────────────
def create_token(user_id, username):
    payload = {
        'sub': str(user_id),
        'name': username,
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(days=30)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')


def token_required(f):
    """Decorator – injects `current_user` dict into the route."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]
        if not token:
            return jsonify({'status': 'error', 'message': 'Missing auth token'}), 401
        try:
            data = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
            user = db_query('SELECT * FROM users WHERE id = %s', (int(data['sub']),), one=True)
            if not user:
                return jsonify({'status': 'error', 'message': 'User not found'}), 401
        except jwt.ExpiredSignatureError:
            return jsonify({'status': 'error', 'message': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'status': 'error', 'message': 'Invalid token'}), 401
        return f(current_user=user, *args, **kwargs)
    return decorated


# ═══════════════════════════════════════════
#  STATIC FILE SERVING
# ═══════════════════════════════════════════
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


@app.route('/<path:path>')
def static_files(path):
    # Do not serve python files, sql or db
    blocked = ('.py', '.db', '.sql', '.php', '.env')
    if any(path.endswith(ext) for ext in blocked):
        return "Access denied", 403
    if os.path.exists(path):
        return send_from_directory('.', path)
    return "Not found", 404


# ═══════════════════════════════════════════
#  AUTH ENDPOINTS
# ═══════════════════════════════════════════

# -- Legacy routes for backward compat -------
@app.route('/login.php', methods=['POST'])
@app.route('/login', methods=['POST'])
def legacy_login():
    """Legacy login – redirects internally to the v1 handler."""
    return api_login()


@app.route('/register.php', methods=['POST'])
@app.route('/register', methods=['POST'])
def legacy_register():
    return api_register()


# -- v1 API ----------------------------------
@app.route('/api/v1/auth/login', methods=['POST'])
def api_login():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid JSON'}), 400

    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({'status': 'error', 'message': 'Username and password required'}), 400

    user = db_query('SELECT * FROM users WHERE username = %s', (username,), one=True)
    if not user:
        return jsonify({'status': 'error', 'message': 'User not found'}), 404

    if not check_password_hash(user['password_hash'], password):
        return jsonify({'status': 'error', 'message': 'Incorrect password'}), 401

    token = create_token(user['id'], user['username'])
    return jsonify({
        'status': 'success',
        'token': token,
        'user': {
            'id': user['id'],
            'username': user['username'],
            'name': user['name'],
        }
    })


@app.route('/api/v1/auth/register', methods=['POST'])
def api_register():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid JSON'}), 400

    username = data.get('username', '').strip()
    email    = data.get('email', '').strip()
    password = data.get('password', '')

    if not username or not email or not password:
        return jsonify({'status': 'error', 'message': 'All fields required'}), 400

    existing = db_query('SELECT id FROM users WHERE username = %s', (username,), one=True)
    if existing:
        return jsonify({'status': 'error', 'message': 'Username already exists'}), 409

    pw_hash = generate_password_hash(password)
    user_id = db_query(
        'INSERT INTO users (username, email, password_hash) VALUES (%s, %s, %s)',
        (username, email, pw_hash), commit=True
    )
    # Insert default alert settings
    db_query(
        'INSERT INTO alert_settings (user_id) VALUES (%s)',
        (user_id,), commit=True
    )
    token = create_token(user_id, username)
    return jsonify({
        'status': 'success',
        'message': 'Account created',
        'token': token,
        'user': {'id': user_id, 'username': username}
    }), 201


# ═══════════════════════════════════════════
#  USER PROFILE
# ═══════════════════════════════════════════
@app.route('/api/v1/users/profile', methods=['GET'])
@token_required
def get_profile(current_user):
    u = current_user
    bmr  = _calc_bmr(u)
    tdee = _calc_tdee(u)
    return jsonify({
        'status': 'success',
        'profile': {
            'id':            u['id'],
            'username':      u['username'],
            'email':         u['email'],
            'name':          u['name'],
            'gender':        u['gender'],
            'age':           u['age'],
            'height':        u['height'],
            'weight':        u['weight'],
            'target_weight': u['target_weight'],
            'activity':      u['activity'],
            'goal':          u['goal'],
            'bmr':           bmr,
            'tdee':          tdee,
        }
    })


@app.route('/api/v1/users/profile', methods=['PUT'])
@token_required
def update_profile(current_user):
    data = request.get_json(silent=True) or {}
    allowed = ('name', 'gender', 'age', 'height', 'weight', 'target_weight', 'activity', 'goal')
    updates = {k: data[k] for k in allowed if k in data}

    if not updates:
        return jsonify({'status': 'error', 'message': 'No valid fields to update'}), 400

    set_clause = ', '.join(f'{k} = %s' for k in updates)
    values = list(updates.values()) + [current_user['id']]
    db_query(f'UPDATE users SET {set_clause} WHERE id = %s', values, commit=True)

    # Fetch updated user
    user = db_query('SELECT * FROM users WHERE id = %s', (current_user['id'],), one=True)
    bmr  = _calc_bmr(user)
    tdee = _calc_tdee(user)
    return jsonify({
        'status': 'success',
        'message': 'Profile updated',
        'profile': {
            'id':            user['id'],
            'username':      user['username'],
            'name':          user['name'],
            'gender':        user['gender'],
            'age':           user['age'],
            'height':        user['height'],
            'weight':        user['weight'],
            'target_weight': user['target_weight'],
            'activity':      user['activity'],
            'goal':          user['goal'],
            'bmr':           bmr,
            'tdee':          tdee,
        }
    })


# ═══════════════════════════════════════════
#  MEAL LOGGING
# ═══════════════════════════════════════════
@app.route('/api/v1/meals', methods=['GET'])
@token_required
def get_meals(current_user):
    meal_date = request.args.get('date', date.today().isoformat())
    rows = db_query(
        'SELECT id, meal_date, meal_type, food_name, calories, created_at '
        'FROM meals WHERE user_id = %s AND meal_date = %s ORDER BY created_at',
        (current_user['id'], meal_date)
    )
    # Group by meal_type
    grouped = {'breakfast': [], 'lunch': [], 'dinner': [], 'snacks': []}
    for r in rows:
        grouped.setdefault(r['meal_type'], []).append({
            'id': r['id'],
            'name': r['food_name'],
            'cal': r['calories'],
        })

    total = sum(r['calories'] for r in rows)
    tdee  = _calc_tdee(current_user)
    return jsonify({
        'status': 'success',
        'date': meal_date,
        'meals': grouped,
        'total_calories': total,
        'goal': tdee,
        'remaining': max(0, tdee - total),
    })


@app.route('/api/v1/meals', methods=['POST'])
@token_required
def add_meal(current_user):
    data = request.get_json(silent=True) or {}
    meal_type = data.get('meal_type', '').lower()
    food_name = data.get('food_name', '').strip()
    calories  = data.get('calories', 0)
    meal_date = data.get('date', date.today().isoformat())

    if meal_type not in ('breakfast', 'lunch', 'dinner', 'snacks'):
        return jsonify({'status': 'error', 'message': 'Invalid meal_type'}), 400
    if not food_name or not calories:
        return jsonify({'status': 'error', 'message': 'food_name and calories required'}), 400

    meal_id = db_query(
        'INSERT INTO meals (user_id, meal_date, meal_type, food_name, calories) '
        'VALUES (%s, %s, %s, %s, %s)',
        (current_user['id'], meal_date, meal_type, food_name, int(calories)),
        commit=True
    )

    # Check goal alerts
    total = _total_cal_for_date(current_user['id'], meal_date)
    prev  = total - int(calories)
    tdee  = _calc_tdee(current_user)
    alerts_fired = []

    settings = db_query(
        'SELECT * FROM alert_settings WHERE user_id = %s',
        (current_user['id'],), one=True
    )
    if settings:
        if settings.get('alert_calorie_goal') and prev < tdee <= total:
            _add_notification(current_user['id'], 'goal', '🎯',
                              'Daily Goal Reached! 🎯',
                              f"You've hit your {tdee} kcal target for today. Great job!")
            alerts_fired.append('calorie-goal')
        if settings.get('alert_over_budget') and total > tdee and prev <= tdee:
            _add_notification(current_user['id'], 'warning', '⚠️',
                              'Over Budget ⚠️',
                              f"You've exceeded your daily goal by {total - tdee} kcal.")
            alerts_fired.append('over-budget')

    return jsonify({
        'status': 'success',
        'meal': {'id': meal_id, 'name': food_name, 'cal': int(calories), 'meal_type': meal_type},
        'total_calories': total,
        'goal': tdee,
        'remaining': max(0, tdee - total),
        'alerts_fired': alerts_fired,
    }), 201


@app.route('/api/v1/meals/scan', methods=['POST'])
@token_required
def scan_meal(current_user):
    FOOD_CALORIES = {
        "apple": 95, "banana": 105, "orange": 62, "pizza": 285, "burger": 250, "fries": 312,
        "salad": 150, "sandwich": 250, "rice": 205, "chicken": 165, "beef": 250, "pork": 242,
        "fish": 206, "egg": 78, "bread": 79, "pasta": 131, "noodle": 138, "soup": 150,
        "cheese": 113, "milk": 103, "yogurt": 100, "ice cream": 137, "cake": 235, "cookie": 50,
        "chocolate": 150, "candy": 100, "donut": 195, "muffin": 377, "pancake": 86, "waffle": 82,
        "pie": 237, "croissant": 231, "bagel": 245, "cereal": 110, "oatmeal": 158, "granola": 110,
        "toast": 75, "butter": 102, "jam": 56, "honey": 64, "syrup": 52, "ketchup": 15,
        "mustard": 3, "mayonnaise": 94, "salsa": 4, "guacamole": 50, "hummus": 27, "peanut butter": 94,
        "jelly": 53, "soda": 140, "juice": 110, "coffee": 2, "tea": 2, "water": 0, "beer": 153,
        "wine": 125, "liquor": 97, "cocktail": 150, "steak": 679, "sushi": 200, "taco": 156,
        "hot dog": 150, "bacon": 43, "sausage": 133, "ham": 46, "turkey": 135, "lamb": 250,
        "shrimp": 84, "crab": 82, "lobster": 89, "clam": 74, "oyster": 41, "mussel": 86,
        "scallop": 69, "squid": 78, "octopus": 82, "onion": 40, "garlic": 4, "tomato": 22,
        "potato": 161, "carrot": 41, "broccoli": 55, "cauliflower": 25, "spinach": 7, "lettuce": 5,
        "cucumber": 16, "pepper": 24, "mushroom": 15, "corn": 132, "peas": 118, "bean": 227
    }

    data = request.get_json(silent=True) or {}
    image_data = data.get('image', '')
    if not image_data:
        return jsonify({'error': 'No image provided'}), 400

    if ',' in image_data:
        image_data = image_data.split(',')[1]

    try:
        img_bytes = base64.b64decode(image_data)
        if len(img_bytes) > 5 * 1024 * 1024:
            return jsonify({'error': 'Image too large, please use a smaller photo'}), 400
    except Exception:
        return jsonify({'error': 'Invalid image data'}), 400

    temp_path = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4().hex}.jpg")
    try:
        with open(temp_path, 'wb') as f:
            f.write(img_bytes)

        api_key = os.environ.get("ROBOFLOW_API_KEY")
        if not api_key:
            return jsonify({'error': 'Server misconfiguration: Roboflow API key missing'}), 500

        client = InferenceHTTPClient(
            api_url="https://serverless.roboflow.com",
            api_key=api_key
        )
        result = client.run_workflow(
            workspace_name="john-lloyd-apao",
            workflow_id="Detect-and-Classify",
            images={"image": temp_path},
            use_cache=True
        )

        result_str = json.dumps(result).lower()
        food_name = None

        for key in ['top', 'class', 'class_name', 'predicted_class', 'label', 'prediction']:
            match = re.search(rf'"{key}"\s*:\s*"([^"]+)"', result_str)
            if match:
                food_name = match.group(1)
                break
        
        if not food_name:
            for food in FOOD_CALORIES:
                if food in result_str:
                    food_name = food
                    break

        if not food_name:
            return jsonify({'error': 'Could not identify food, please enter manually'}), 400

        food_name_clean = food_name.replace("_", " ").strip()
        
        calories = 200
        if food_name_clean in FOOD_CALORIES:
            calories = FOOD_CALORIES[food_name_clean]
        else:
            for food, cal in FOOD_CALORIES.items():
                if food in food_name_clean or food_name_clean in food:
                    calories = cal
                    break

        return jsonify({
            'food_name': food_name_clean.capitalize(),
            'calories': calories
        })

    except Exception as e:
        print(f"Roboflow error: {e}")
        return jsonify({'error': 'Could not identify food, please enter manually'}), 400
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.route('/api/v1/meals/<int:meal_id>', methods=['DELETE'])
@token_required
def delete_meal(current_user, meal_id):
    meal = db_query(
        'SELECT * FROM meals WHERE id = %s AND user_id = %s',
        (meal_id, current_user['id']), one=True
    )
    if not meal:
        return jsonify({'status': 'error', 'message': 'Meal not found'}), 404

    db_query('DELETE FROM meals WHERE id = %s', (meal_id,), commit=True)
    return jsonify({'status': 'success', 'message': 'Meal deleted'})


# ═══════════════════════════════════════════
#  WEIGHT TRACKING
# ═══════════════════════════════════════════
@app.route('/api/v1/weight', methods=['POST'])
@token_required
def log_weight(current_user):
    data = request.get_json(silent=True) or {}
    weight_kg = data.get('weight')
    weight_date = data.get('date', date.today().isoformat())

    if not weight_kg:
        return jsonify({'status': 'error', 'message': 'weight is required'}), 400

    # UPSERT
    db_query(
        'INSERT INTO weights (user_id, weight_date, weight_kg) VALUES (%s, %s, %s) '
        'ON DUPLICATE KEY UPDATE weight_kg = VALUES(weight_kg)',
        (current_user['id'], weight_date, float(weight_kg)),
        commit=True
    )
    return jsonify({'status': 'success', 'message': f'Logged {weight_kg} kg', 'date': weight_date})


@app.route('/api/v1/weight/history', methods=['GET'])
@token_required
def weight_history(current_user):
    limit = request.args.get('limit', 30, type=int)
    rows = db_query(
        'SELECT weight_date, weight_kg FROM weights '
        'WHERE user_id = %s ORDER BY weight_date DESC LIMIT %s',
        (current_user['id'], limit)
    )
    return jsonify({'status': 'success', 'weights': rows})


# ═══════════════════════════════════════════
#  PROGRESS / ANALYTICS
# ═══════════════════════════════════════════
@app.route('/api/v1/progress/summary', methods=['GET'])
@token_required
def progress_summary(current_user):
    uid = current_user['id']
    today = date.today()

    # ── Streak ──
    streak = _calc_streak(uid)

    # ── Last 14 days calorie data ──
    start_14 = today - timedelta(days=13)
    rows = db_query(
        'SELECT meal_date, SUM(calories) as total '
        'FROM meals WHERE user_id = %s AND meal_date >= %s '
        'GROUP BY meal_date ORDER BY meal_date',
        (uid, start_14.isoformat())
    )
    daily_map = {r['meal_date']: int(r['total']) for r in rows}
    cal_data = []
    labels = []
    for i in range(14):
        d = start_14 + timedelta(days=i)
        key = d.isoformat()
        cal_data.append(daily_map.get(key, 0))
        labels.append(d.strftime('%b %d'))

    days_with_data = [c for c in cal_data if c > 0]
    avg_cal = round(sum(days_with_data) / max(len(days_with_data), 1))

    # ── Meal type breakdown (14 days) ──
    meal_rows = db_query(
        'SELECT meal_type, SUM(calories) as total '
        'FROM meals WHERE user_id = %s AND meal_date >= %s '
        'GROUP BY meal_type',
        (uid, start_14.isoformat())
    )
    meal_totals = {r['meal_type']: int(r['total']) for r in meal_rows}

    # ── Weight delta ──
    weight_rows = db_query(
        'SELECT weight_date, weight_kg FROM weights '
        'WHERE user_id = %s ORDER BY weight_date',
        (uid,)
    )
    weight_delta = None
    if len(weight_rows) >= 2:
        start_w = current_user.get('weight') or weight_rows[0]['weight_kg']
        latest_w = weight_rows[-1]['weight_kg']
        weight_delta = round(float(latest_w) - float(start_w), 1)

    # ── Weight progress toward target ──
    start_weight  = float(current_user.get('weight') or 0)
    target_weight = float(current_user.get('target_weight') or 0)
    current_weight = float(weight_rows[-1]['weight_kg']) if weight_rows else start_weight
    weight_progress_pct = 0
    if start_weight and target_weight and abs(target_weight - start_weight) > 0:
        total_diff = abs(target_weight - start_weight)
        done_diff  = abs(current_weight - start_weight)
        weight_progress_pct = min(100, round(done_diff / total_diff * 100))

    tdee = _calc_tdee(current_user)

    return jsonify({
        'status': 'success',
        'streak': streak,
        'avg_calories': avg_cal,
        'days_logged': len(days_with_data),
        'goal': tdee,
        'labels': labels,
        'cal_data': cal_data,
        'meal_totals': {
            'breakfast': meal_totals.get('breakfast', 0),
            'lunch':     meal_totals.get('lunch', 0),
            'dinner':    meal_totals.get('dinner', 0),
            'snacks':    meal_totals.get('snacks', 0),
        },
        'weight_delta': weight_delta,
        'weight_history': weight_rows,
        'weight_progress_pct': weight_progress_pct,
        'start_weight': start_weight,
        'target_weight': target_weight,
        'current_weight': current_weight,
    })


# ═══════════════════════════════════════════
#  NOTIFICATIONS
# ═══════════════════════════════════════════
@app.route('/api/v1/notifications', methods=['GET'])
@token_required
def get_notifications(current_user):
    rows = db_query(
        'SELECT id, type, icon, title, body, is_read, created_at '
        'FROM notifications WHERE user_id = %s ORDER BY created_at DESC LIMIT 50',
        (current_user['id'],)
    )
    return jsonify({'status': 'success', 'notifications': rows})


@app.route('/api/v1/notifications/read', methods=['PUT'])
@token_required
def mark_notifications_read(current_user):
    db_query(
        'UPDATE notifications SET is_read = 1 WHERE user_id = %s AND is_read = 0',
        (current_user['id'],), commit=True
    )
    return jsonify({'status': 'success'})


@app.route('/api/v1/notifications/<int:notif_id>', methods=['DELETE'])
@token_required
def delete_notification(current_user, notif_id):
    db_query(
        'DELETE FROM notifications WHERE id = %s AND user_id = %s',
        (notif_id, current_user['id']), commit=True
    )
    return jsonify({'status': 'success'})


@app.route('/api/v1/notifications', methods=['DELETE'])
@token_required
def clear_notifications(current_user):
    db_query(
        'DELETE FROM notifications WHERE user_id = %s',
        (current_user['id'],), commit=True
    )
    return jsonify({'status': 'success'})


# ═══════════════════════════════════════════
#  ALERT SETTINGS
# ═══════════════════════════════════════════
@app.route('/api/v1/alerts/settings', methods=['GET'])
@token_required
def get_alert_settings(current_user):
    s = db_query(
        'SELECT * FROM alert_settings WHERE user_id = %s',
        (current_user['id'],), one=True
    )
    if not s:
        db_query('INSERT INTO alert_settings (user_id) VALUES (%s)',
                 (current_user['id'],), commit=True)
        s = db_query('SELECT * FROM alert_settings WHERE user_id = %s',
                     (current_user['id'],), one=True)
    return jsonify({
        'status': 'success',
        'settings': {
            'reminders': {
                'breakfast': bool(s['reminder_breakfast']),
                'lunch':     bool(s['reminder_lunch']),
                'dinner':    bool(s['reminder_dinner']),
            },
            'goalAlerts': {
                'calorie-goal':  bool(s['alert_calorie_goal']),
                'over-budget':   bool(s['alert_over_budget']),
                'streak':        bool(s['alert_streak']),
                'weekly-report': bool(s['alert_weekly_report']),
            }
        }
    })


@app.route('/api/v1/alerts/settings', methods=['PUT'])
@token_required
def update_alert_settings(current_user):
    data = request.get_json(silent=True) or {}
    col_map = {
        'reminder_breakfast': data.get('reminder_breakfast'),
        'reminder_lunch':     data.get('reminder_lunch'),
        'reminder_dinner':    data.get('reminder_dinner'),
        'alert_calorie_goal': data.get('alert_calorie_goal'),
        'alert_over_budget':  data.get('alert_over_budget'),
        'alert_streak':       data.get('alert_streak'),
        'alert_weekly_report': data.get('alert_weekly_report'),
    }
    updates = {k: int(v) for k, v in col_map.items() if v is not None}
    if not updates:
        return jsonify({'status': 'error', 'message': 'No valid fields'}), 400

    set_clause = ', '.join(f'{k} = %s' for k in updates)
    values = list(updates.values()) + [current_user['id']]
    db_query(f'UPDATE alert_settings SET {set_clause} WHERE user_id = %s',
             values, commit=True)
    return jsonify({'status': 'success', 'message': 'Settings updated'})


# ═══════════════════════════════════════════
#  FCM TOKEN
# ═══════════════════════════════════════════
@app.route('/api/save-token', methods=['POST'])
@app.route('/api/v1/fcm-token', methods=['POST'])
def save_fcm_token():
    data = request.get_json(silent=True) or {}
    token = data.get('token')
    if not token:
        return jsonify({'status': 'error', 'message': 'Missing FCM token'}), 400

    user_id = None

    # Try JWT auth first (most reliable)
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        try:
            jwt_data = jwt.decode(auth_header[7:], SECRET_KEY, algorithms=['HS256'])
            user_id = int(jwt_data['sub'])
        except Exception:
            pass

    # Fallback: look up by username from body
    if not user_id:
        username = data.get('username', '')
        if username:
            user = db_query('SELECT id FROM users WHERE username = %s',
                            (username,), one=True)
            user_id = user['id'] if user else None

    if not user_id:
        return jsonify({'status': 'error', 'message': 'User not identified'}), 400

    # Delete old tokens for this user, insert new
    db_query('DELETE FROM fcm_tokens WHERE user_id = %s', (user_id,), commit=True)
    db_query('INSERT INTO fcm_tokens (user_id, token) VALUES (%s, %s)',
             (user_id, token), commit=True)
    print(f'[FCM] Saved token for user {user_id}: {token[:30]}...')
    return jsonify({'status': 'success', 'user_id': user_id})


# ═══════════════════════════════════════════
#  BUSINESS LOGIC (server-side)
# ═══════════════════════════════════════════
def _calc_bmr(user):
    """Mifflin-St Jeor formula."""
    w = float(user.get('weight') or 0)
    h = float(user.get('height') or 0)
    a = int(user.get('age') or 0)
    if not w or not h or not a:
        return 2000
    gender = user.get('gender', 'male')
    bmr = 10 * w + 6.25 * h - 5 * a + (-161 if gender == 'female' else 5)
    return round(bmr)


def _calc_tdee(user):
    """TDEE = BMR × activity factor ± goal adjustment."""
    bmr = _calc_bmr(user)
    activity = float(user.get('activity') or 1.55)
    tdee = round(bmr * activity)
    goal = user.get('goal', 'maintain')
    if goal == 'lose':
        tdee -= 500
    elif goal == 'gain':
        tdee += 300
    return max(1200, tdee)


def _total_cal_for_date(user_id, meal_date):
    row = db_query(
        'SELECT COALESCE(SUM(calories), 0) as total FROM meals '
        'WHERE user_id = %s AND meal_date = %s',
        (user_id, meal_date), one=True
    )
    return int(row['total']) if row else 0


def _calc_streak(user_id):
    """Count consecutive days with at least one meal logged, ending today."""
    today = date.today()
    streak = 0
    for i in range(365):
        d = today - timedelta(days=i)
        total = _total_cal_for_date(user_id, d.isoformat())
        if total > 0:
            streak += 1
        elif i > 0:
            break
    return streak


def _add_notification(user_id, ntype, icon, title, body):
    db_query(
        'INSERT INTO notifications (user_id, type, icon, title, body) '
        'VALUES (%s, %s, %s, %s, %s)',
        (user_id, ntype, icon, title, body), commit=True
    )
    _send_push(user_id, title, body)

def _send_push(user_id, title, body):
    """Send a push notification via FCM to all of a user's devices."""
    tokens = db_query(
        'SELECT token FROM fcm_tokens WHERE user_id = %s',
        (user_id,)
    )
    for row in tokens:
        try:
            message = fcm_messaging.Message(
                notification=fcm_messaging.Notification(
                    title=title,
                    body=body,
                ),
                token=row['token'],
            )
            response = fcm_messaging.send(message)
            print(f'[FCM] Successfully sent push to user {user_id}')
        except Exception as e:
            print(f'[FCM] Failed to send to token: {e}')
            # Optionally delete invalid tokens
            if 'not registered' in str(e).lower() or 'invalid' in str(e).lower():
                db_query('DELETE FROM fcm_tokens WHERE token = %s',
                         (row['token'],), commit=True)


# ═══════════════════════════════════════════
#  TEST PUSH (dev only — remove in production)
# ═══════════════════════════════════════════
@app.route('/api/v1/test-push', methods=['POST'])
@token_required
def test_push(current_user):
    """Send a test push notification to the current user."""
    data = request.get_json(silent=True) or {}
    title = data.get('title', '🔔 Test Push from NutriPulse')
    body  = data.get('body', 'If you see this, push notifications are working!')
    _add_notification(current_user['id'], 'goal', '🎯', title, body)
    return jsonify({
        'status': 'success',
        'message': f'Push sent to user {current_user["id"]}'
    })


# ═══════════════════════════════════════════
#  STARTUP
# ═══════════════════════════════════════════
if __name__ == '__main__':
    app.run(debug=True, port=5000)
