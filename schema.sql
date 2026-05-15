-- ══════════════════════════════════════════
-- NutriPulse — MySQL Schema
-- Run this against your XAMPP MySQL instance
-- ══════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS nutripulse
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE nutripulse;

-- ─── USERS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(80)  NOT NULL UNIQUE,
    email         TEXT         NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    -- profile fields
    name          TEXT         DEFAULT NULL,
    gender        ENUM('male','female') DEFAULT 'male',
    age           INT          DEFAULT NULL,
    height        DECIMAL(5,1) DEFAULT NULL,   -- cm
    weight        DECIMAL(5,1) DEFAULT NULL,   -- kg
    target_weight DECIMAL(5,1) DEFAULT NULL,   -- kg
    activity      DECIMAL(3,2) DEFAULT 1.55,
    goal          ENUM('lose','maintain','gain') DEFAULT 'maintain',
    created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ─── MEALS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS meals (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT          NOT NULL,
    meal_date  DATE         NOT NULL,
    meal_type  ENUM('breakfast','lunch','dinner','snacks') NOT NULL,
    food_name  TEXT         NOT NULL,
    calories   INT          NOT NULL DEFAULT 0,
    created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_date (user_id, meal_date)
) ENGINE=InnoDB;

-- ─── WEIGHTS ───────────────────────────────
CREATE TABLE IF NOT EXISTS weights (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT          NOT NULL,
    weight_date DATE         NOT NULL,
    weight_kg   DECIMAL(5,1) NOT NULL,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uq_user_date (user_id, weight_date)
) ENGINE=InnoDB;

-- ─── FCM TOKENS ────────────────────────────
CREATE TABLE IF NOT EXISTS fcm_tokens (
    id       INT AUTO_INCREMENT PRIMARY KEY,
    user_id  INT          NOT NULL,
    token    TEXT         NOT NULL,
    created_at DATETIME   DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ─── NOTIFICATIONS ─────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT          NOT NULL,
    type       VARCHAR(32)  NOT NULL DEFAULT 'info',
    icon       VARCHAR(8)   DEFAULT '🔔',
    title      VARCHAR(255) NOT NULL,
    body       TEXT,
    is_read    TINYINT(1)   DEFAULT 0,
    created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_read (user_id, is_read)
) ENGINE=InnoDB;

-- ─── ALERT SETTINGS ───────────────────────
CREATE TABLE IF NOT EXISTS alert_settings (
    id       INT AUTO_INCREMENT PRIMARY KEY,
    user_id  INT          NOT NULL UNIQUE,
    -- meal reminders
    reminder_breakfast TINYINT(1) DEFAULT 1,
    reminder_lunch     TINYINT(1) DEFAULT 1,
    reminder_dinner    TINYINT(1) DEFAULT 1,
    -- goal alerts
    alert_calorie_goal TINYINT(1) DEFAULT 1,
    alert_over_budget  TINYINT(1) DEFAULT 1,
    alert_streak       TINYINT(1) DEFAULT 1,
    alert_weekly_report TINYINT(1) DEFAULT 1,
    master_enabled     TINYINT(1) DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
