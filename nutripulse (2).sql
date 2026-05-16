-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: May 16, 2026 at 05:08 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `nutripulse`
--

-- --------------------------------------------------------

--
-- Table structure for table `alert_settings`
--

CREATE TABLE `alert_settings` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `reminder_breakfast` tinyint(1) DEFAULT 1,
  `reminder_lunch` tinyint(1) DEFAULT 1,
  `reminder_dinner` tinyint(1) DEFAULT 1,
  `alert_calorie_goal` tinyint(1) DEFAULT 1,
  `alert_over_budget` tinyint(1) DEFAULT 1,
  `alert_streak` tinyint(1) DEFAULT 1,
  `alert_weekly_report` tinyint(1) DEFAULT 1,
  `master_enabled` tinyint(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `alert_settings`
--

INSERT INTO `alert_settings` (`id`, `user_id`, `reminder_breakfast`, `reminder_lunch`, `reminder_dinner`, `alert_calorie_goal`, `alert_over_budget`, `alert_streak`, `alert_weekly_report`, `master_enabled`) VALUES
(8, 8, 1, 1, 1, 1, 1, 1, 1, 1);

-- --------------------------------------------------------

--
-- Table structure for table `fcm_tokens`
--

CREATE TABLE `fcm_tokens` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `token` text NOT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `fcm_tokens`
--

INSERT INTO `fcm_tokens` (`id`, `user_id`, `token`, `created_at`) VALUES
(326, 8, 'eneQxzcL-q8MiyLcilQV0-:APA91bEbflhqhWj7AbP-aGozwPbJbk4cP4CYJLVxB0CBggDDwteeTin1nAMJmsH6DbeMirWo5VgabBnEPH7GrQQ-gTlUgCnP2dVybriOc5ujJx9sJSe5F3U', '2026-05-16 11:00:11');

-- --------------------------------------------------------

--
-- Table structure for table `meals`
--

CREATE TABLE `meals` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `meal_date` date NOT NULL,
  `meal_type` enum('breakfast','lunch','dinner','snacks') NOT NULL,
  `food_name` text NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `calories` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `meals`
--

INSERT INTO `meals` (`id`, `user_id`, `meal_date`, `meal_type`, `food_name`, `created_at`, `calories`) VALUES
(9, 8, '2026-05-15', 'lunch', 'gAAAAABqBvMrEkyhNZzj4zIG-aQlMIJlRuvGqAl2gQKVgOjC4INebgY5qO5BEE3Tax-0DzecxdQFoiPaImmsS_jWCuBJ2N2U9A==', '2026-05-15 18:19:23', 'gAAAAABqByYNees7jEO8fSE-Yky3huJeCMbLDGt3hG0fKRe2ww3LRMcreMsXcpzPLQo2wZljC-dMBasLoejL1aFXVqZyVAYuwA==');

-- --------------------------------------------------------

--
-- Table structure for table `notifications`
--

CREATE TABLE `notifications` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `type` varchar(32) NOT NULL DEFAULT 'info',
  `icon` varchar(8) DEFAULT '?',
  `title` varchar(255) NOT NULL,
  `body` text DEFAULT NULL,
  `is_read` tinyint(1) DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `notifications`
--

INSERT INTO `notifications` (`id`, `user_id`, `type`, `icon`, `title`, `body`, `is_read`, `created_at`) VALUES
(37, 8, 'goal', '🎯', 'Daily Goal Reached! 🎯', 'You\'ve hit your 2076 kcal target for today. Great job!', 0, '2026-05-15 18:19:23'),
(38, 8, 'warning', '⚠️', 'Over Budget ⚠️', 'You\'ve exceeded your daily goal by 10146 kcal.', 0, '2026-05-15 18:19:25');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `username` varchar(80) NOT NULL,
  `email` text NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `name` text DEFAULT NULL,
  `gender` enum('male','female') DEFAULT 'male',
  `target_weight` text DEFAULT NULL,
  `activity` decimal(3,2) DEFAULT 1.55,
  `goal` enum('lose','maintain','gain') DEFAULT 'maintain',
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `age` text DEFAULT NULL,
  `height` text DEFAULT NULL,
  `weight` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `username`, `email`, `password_hash`, `name`, `gender`, `target_weight`, `activity`, `goal`, `created_at`, `updated_at`, `age`, `height`, `weight`) VALUES
(8, 'John', 'gAAAAABqBvLZiReuyQxtEzX7KG25SCemasUIdjIOQikYIZIoVI7NHs9vQQo-8QPvSnF8E0jEt2nZBWfT5kgSLby-S8S1V_-PTg==', 'scrypt:32768:8:1$OFtXq7ePo2yXhSYg$fed0a69aacc9d1e034bf0f14972211f2812880a84339412f1ddd5fdccc0d2ae2b22dee475902d9125c94ea57ee545d0494582af70e974de01cc1516ffd04699d', 'gAAAAABqBvL_rZaHQf1njFyxtaptd46ZjbRyUBm9T-4VBEMGrcN6bdSMKLytnICy0uh-YK_3l4qbk3W0-YRNXLJkyZQJLUrqpw==', 'male', '55', 1.55, 'lose', '2026-05-15 18:18:01', '2026-05-15 21:56:29', 'gAAAAABqByYNSx4q8ykWilqB17E-Zvfw4Ah1j-pbl1CBAuCiPhwW5SflfxPW07JsLBgegruILkCS73oTKJs5WFC9PLm_k6V-TA==', 'gAAAAABqByYNwTFGZDWrxi_3flBOIOLL2trymdX6vYuOSMv6FBa5GDivi-krqjJvBET0TpiOg7RmkhBfwjr2PjxTTnwN2Xk0DQ==', 'gAAAAABqByYNXXEA28cmLWkDUNRUzPBlAF9WOmNP3PTR6O6A-BdTosoli3sfLbM9A1uvIp_0fpdihwioCGZlIt6vrKMuleonNw==');

-- --------------------------------------------------------

--
-- Table structure for table `weights`
--

CREATE TABLE `weights` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `weight_date` date NOT NULL,
  `weight_kg` decimal(5,1) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `weights`
--

INSERT INTO `weights` (`id`, `user_id`, `weight_date`, `weight_kg`, `created_at`) VALUES
(6, 8, '2026-05-16', 67.0, '2026-05-16 10:30:45');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `alert_settings`
--
ALTER TABLE `alert_settings`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `user_id` (`user_id`);

--
-- Indexes for table `fcm_tokens`
--
ALTER TABLE `fcm_tokens`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indexes for table `meals`
--
ALTER TABLE `meals`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_user_date` (`user_id`,`meal_date`);

--
-- Indexes for table `notifications`
--
ALTER TABLE `notifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_user_read` (`user_id`,`is_read`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `username` (`username`);

--
-- Indexes for table `weights`
--
ALTER TABLE `weights`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_user_date` (`user_id`,`weight_date`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `alert_settings`
--
ALTER TABLE `alert_settings`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- AUTO_INCREMENT for table `fcm_tokens`
--
ALTER TABLE `fcm_tokens`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=327;

--
-- AUTO_INCREMENT for table `meals`
--
ALTER TABLE `meals`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=12;

--
-- AUTO_INCREMENT for table `notifications`
--
ALTER TABLE `notifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=39;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- AUTO_INCREMENT for table `weights`
--
ALTER TABLE `weights`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `alert_settings`
--
ALTER TABLE `alert_settings`
  ADD CONSTRAINT `alert_settings_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `fcm_tokens`
--
ALTER TABLE `fcm_tokens`
  ADD CONSTRAINT `fcm_tokens_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `meals`
--
ALTER TABLE `meals`
  ADD CONSTRAINT `meals_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `notifications`
--
ALTER TABLE `notifications`
  ADD CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `weights`
--
ALTER TABLE `weights`
  ADD CONSTRAINT `weights_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
