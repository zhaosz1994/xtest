-- MySQL dump 10.13  Distrib 9.6.0, for macos26.2 (arm64)
--
-- Host: localhost    Database: xtest_db
-- ------------------------------------------------------
-- Server version	9.6.0

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '3571cebc-18a9-11f1-89b4-0bee8becfe33:1-57100';

--
-- Table structure for table `activity_logs`
--

DROP TABLE IF EXISTS `activity_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `activity_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `username` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `entity_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `entity_id` int DEFAULT NULL,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_action` (`action`),
  KEY `idx_activity_logs_user_id` (`user_id`),
  KEY `idx_activity_logs_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=94 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `activity_logs`
--

LOCK TABLES `activity_logs` WRITE;
/*!40000 ALTER TABLE `activity_logs` DISABLE KEYS */;
INSERT INTO `activity_logs` VALUES (1,1,'admin','管理员','用户登录','用户 admin 登录系统','user',1,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-24 04:39:30'),(2,1,'admin','管理员','添加用户','管理员 admin 添加了新用户 zhaosz','user',3,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-24 04:40:18'),(3,3,'zhaosz','管理员','用户登录','用户 zhaosz 登录系统','user',3,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-24 04:40:32'),(4,3,'zhaosz','管理员','创建用例库','创建了用例库 U12芯片测试','case_library',1,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-24 05:12:53'),(5,1,'admin','管理员','用户登录','用户 admin 登录系统','user',1,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-26 03:18:59'),(6,1,'admin','管理员','创建用例库','创建了用例库 芯片测试','case_library',2,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-26 03:24:30'),(7,1,'admin','管理员','用户登录','用户 admin 登录系统','user',1,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-29 14:50:37'),(8,3,'zhaosz','管理员','用户登录','用户 zhaosz 登录系统','user',3,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-29 15:14:21'),(9,3,'zhaosz','管理员','批量创建测试用例','在模块 \"NetRx\" 下批量创建了 4 个测试用例','test_case',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 07:33:51'),(10,3,'zhaosz','管理员','批量创建测试用例','在模块 \"NetRx\" 下批量创建了 2 个测试用例','test_case',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 07:40:12'),(11,3,'zhaosz','管理员','批量创建测试用例','在模块 \"NetRx\" 下批量创建了 2 个测试用例','test_case',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 07:48:07'),(12,3,'zhaosz','管理员','批量创建测试用例','在模块 \"NetRx\" 下批量创建了 2 个测试用例','test_case',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 08:04:11'),(13,3,'zhaosz','管理员','批量创建测试用例','在模块 \"NetRx\" 下批量创建了 2 个测试用例','test_case',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 08:14:18'),(14,3,'zhaosz','管理员','批量创建测试用例','在模块 \"NetRx\" 下批量创建了 1 个测试用例','test_case',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 10:11:06'),(15,3,'zhaosz','管理员','批量创建测试用例','在模块 \"NetRx\" 下批量创建了 1 个测试用例','test_case',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 10:19:50'),(16,3,'zhaosz','管理员','批量创建测试用例','在模块 \"NetRx\" 下批量创建了 1 个测试用例','test_case',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 10:28:47'),(17,3,'zhaosz','管理员','批量创建测试用例','在模块 \"NetTx\" 下批量创建了 1 个测试用例','test_case',5,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 10:36:50'),(18,3,'zhaosz','管理员','添加用户','管理员 zhaosz 添加了新用户 cccc','user',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 11:23:48'),(19,4,'cccc','测试人员','用户登录','用户 cccc 登录系统','user',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 11:24:07'),(20,4,'cccc','测试人员','批量创建测试用例','在模块 \"NetRx\" 下批量创建了 1 个测试用例','test_case',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 11:25:01'),(21,4,'cccc','测试人员','批量创建测试用例','在模块 \"NetRx\" 下批量创建了 1 个测试用例','test_case',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 11:33:19'),(22,4,'cccc','测试人员','批量创建测试用例','在模块 \"NetRx\" 下批量创建了 1 个测试用例','test_case',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 11:36:48'),(23,4,'cccc','测试人员','批量创建测试用例','在模块 \"NetRx\" 下批量创建了 1 个测试用例','test_case',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 12:00:14'),(24,4,'cccc','测试人员','批量创建测试用例','在模块 \"NetRx\" 下批量创建了 1 个测试用例','test_case',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 12:01:24'),(25,4,'cccc','测试人员','批量创建测试用例','在模块 \"NetRx\" 下批量创建了 1 个测试用例','test_case',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-30 12:09:59'),(26,1,'admin','管理员','用户登录','用户 admin 登录系统','user',1,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 02:34:59'),(27,1,'admin','管理员','用户登录','用户 admin 登录系统','user',1,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 02:35:11'),(28,4,'cccc','测试人员','用户登录','用户 cccc 登录系统','user',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 02:35:30'),(29,1,'admin','管理员','用户登录','用户 admin 登录系统','user',1,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 03:02:35'),(30,4,'cccc','测试人员','用户登录','用户 cccc 登录系统（记住我）','user',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 03:15:36'),(31,4,'cccc','测试人员','用户登录','用户 cccc 登录系统（记住我）','user',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 03:18:40'),(32,1,'admin','管理员','用户登录','用户 admin 登录系统（记住我）','user',1,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) TraeCN/1.107.1 Chrome/142.0.7444.235 Electron/39.2.7 Safari/537.36','2026-03-31 03:24:15'),(33,4,'cccc','测试人员','用户登录','用户 cccc 登录系统（记住我）','user',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 03:24:47'),(34,4,'cccc','测试人员','用户登录','用户 cccc 登录系统（记住我）','user',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 03:46:33'),(35,4,'cccc','测试人员','用户登录','用户 cccc 登录系统（记住我）','user',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 03:47:18'),(36,4,'cccc','测试人员','创建测试计划','创建了测试计划 v2.0 EMUL NetRx测试，关联 21 条用例','test_plan',1,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 03:49:45'),(37,1,'admin','管理员','用户登录','用户 admin 登录系统（记住我）','user',1,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 03:56:46'),(38,1,'admin','管理员','用户登录','用户 admin 登录系统（记住我）','user',1,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 04:07:32'),(39,1,'admin','管理员','用户登录','用户 admin 登录系统（记住我）','user',1,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 04:49:05'),(40,1,'admin','管理员','用户登录','用户 admin 登录系统（记住我）','user',1,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 04:50:44'),(41,4,'cccc','测试人员','用户登录','用户 cccc 登录系统（记住我）','user',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 05:44:08'),(42,3,'zhaosz','管理员','用户登录','用户 zhaosz 登录系统（记住我）','user',3,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 06:21:30'),(43,3,'zhaosz','管理员','用户登录','用户 zhaosz 登录系统（记住我）','user',3,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) TraeCN/1.107.1 Chrome/142.0.7444.235 Electron/39.2.7 Safari/537.36','2026-03-31 06:59:19'),(44,4,'cccc','测试人员','用户登录','用户 cccc 登录系统（记住我）','user',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) TraeCN/1.107.1 Chrome/142.0.7444.235 Electron/39.2.7 Safari/537.36','2026-03-31 07:27:39'),(45,4,'cccc','测试人员','批量创建测试用例','在模块 \"NetRx\" 下批量创建了 1 个测试用例','test_case',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) TraeCN/1.107.1 Chrome/142.0.7444.235 Electron/39.2.7 Safari/537.36','2026-03-31 07:29:50'),(46,5,'xxxx','测试人员','用户注册','新用户 xxxx 注册成功，等待管理员审核','user',5,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 13:07:24'),(47,3,'zhaosz','管理员','用户登录','用户 zhaosz 登录系统（记住我）','user',3,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 13:07:34'),(48,3,'zhaosz','管理员','用户登录','用户 zhaosz 登录系统（记住我）','user',3,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 13:13:09'),(49,3,'zhaosz','管理员','审核用户','管理员 zhaosz 将用户 xxxx 通过审核','user',5,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 13:14:09'),(50,3,'zhaosz','管理员','用户登录','用户 zhaosz 登录系统','user',3,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-03-31 14:59:29'),(51,3,'zhaosz','管理员','提交评审','提交测试用例 [MinLen检查, 可能小于60B, 统计并丢弃, 基] 进行评审，评审人：zhaosz','test_case',56,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-01 07:36:33'),(52,3,'zhaosz','管理员','用户登录','用户 zhaosz 登录系统','user',3,'::1','curl/8.7.1','2026-04-01 08:02:18'),(53,3,'zhaosz','管理员','用户登录','用户 zhaosz 登录系统','user',3,'::1','curl/8.7.1','2026-04-01 08:48:18'),(54,3,'zhaosz','管理员','用户登录','用户 zhaosz 登录系统','user',3,'::1','curl/8.7.1','2026-04-01 08:48:43'),(55,3,'zhaosz','管理员','提交评审','提交测试用例 [netrx wrr测试-Clone] 进行评审，评审人：zhaosz、cccc','test_case',43,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-01 10:33:09'),(56,3,'zhaosz','管理员','创建测试计划','创建了测试计划 213，关联 18 条用例','test_plan',2,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-01 10:35:27'),(57,3,'zhaosz','管理员','通过评审','通过测试用例 [netrx wrr测试-Clone] 的评审','test_case',43,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-01 12:08:46'),(58,3,'zhaosz','管理员','通过评审','通过测试用例 [MinLen检查, 可能小于60B, 统计并丢弃, 基] 的评审，用例最终状态：已通过','test_case',56,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-01 12:08:53'),(59,1,'admin','管理员','用户登录','用户 admin 登录系统','user',1,'::1','curl/8.7.1','2026-04-01 14:11:05'),(60,1,'admin','管理员','用户登录','用户 admin 登录系统','user',1,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) TraeCN/1.107.1 Chrome/142.0.7444.235 Electron/39.2.7 Safari/537.36','2026-04-01 14:14:04'),(61,3,'zhaosz','管理员','提交评审','提交测试用例 [netrx wrr测试-Clone] 进行评审，评审人：zhaosz','test_case',38,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-01 15:05:53'),(62,3,'zhaosz','管理员','通过评审','通过测试用例 [netrx wrr测试-Clone] 的评审，用例最终状态：已通过','test_case',38,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-01 15:13:56'),(63,3,'zhaosz','管理员','批量提交评审','批量提交 15 个测试用例给 zhaosz 进行评审','test_case',NULL,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-02 05:20:08'),(64,3,'zhaosz','管理员','通过评审','通过测试用例 [U123] 的评审，用例最终状态：已通过','test_case',28,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-02 06:25:16'),(65,3,'zhaosz','管理员','通过评审','通过测试用例 [测试123] 的评审，用例最终状态：已通过','test_case',24,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-02 06:25:21'),(66,3,'zhaosz','管理员','通过评审','通过测试用例 [测试123-Copy] 的评审，用例最终状态：已通过','test_case',25,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-02 07:54:02'),(67,3,'zhaosz','管理员','通过评审','通过测试用例 [测试123-Copy-Copy] 的评审，用例最终状态：已通过','test_case',26,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-02 07:54:55'),(68,4,'cccc','测试人员','用户登录','用户 cccc 登录系统','user',4,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-02 13:26:06'),(69,4,'cccc','测试人员','批量提交评审','批量提交 3 个测试用例给 zhaosz、cccc 进行评审','test_case',NULL,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-02 13:48:34'),(70,4,'cccc','测试人员','通过评审','通过测试用例 [netrx wrr测试-Clone] 的评审','test_case',44,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-02 13:56:57'),(71,4,'cccc','测试人员','通过评审','通过测试用例 [netrx wrr测试-Clone222] 的评审','test_case',45,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-02 13:59:27'),(72,4,'cccc','测试人员','通过评审','通过测试用例 [netrx wrr测试-Clone] 的评审，用例最终状态：已通过','test_case',43,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-02 15:00:46'),(73,4,'cccc','测试人员','通过评审','通过测试用例 [123] 的评审','test_case',46,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-03 02:33:14'),(74,1,'admin','管理员','用户登录','用户 admin 登录系统','user',1,'::1','curl/8.7.1','2026-04-03 05:09:03'),(75,1,'admin','管理员','用户登录','用户 admin 登录系统','user',1,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) TraeCN/1.107.1 Chrome/142.0.7444.235 Electron/39.2.7 Safari/537.36','2026-04-03 06:59:49'),(76,3,'zhaosz','管理员','用户登录','用户 zhaosz 登录系统','user',3,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 01:19:25'),(77,3,'zhaosz','管理员','删除测试用例','删除测试用例 [大胜达-Copy333333-Copy4444-Copy-Copyvvvv]','test_case',117,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:38:59'),(78,3,'zhaosz','管理员','删除测试用例','删除测试用例 [大胜达-Copy333333-Copy4444-Copy]','test_case',115,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:41:25'),(79,3,'zhaosz','管理员','删除测试用例','删除测试用例 [大胜达-Copyhhhhhhh]','test_case',112,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:42:21'),(80,3,'zhaosz','管理员','删除测试用例','删除测试用例 [大胜达-Copyxxxxxxx]','test_case',111,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:42:24'),(81,3,'zhaosz','管理员','删除测试用例','删除测试用例 [大胜达-Copy33333]','test_case',110,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:42:26'),(82,3,'zhaosz','管理员','删除测试用例','删除测试用例 [netrx wrr测试-Clone-Clone-Copy22222]','test_case',109,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:42:28'),(83,3,'zhaosz','管理员','删除测试用例','删除测试用例 [大胜达-Copy]','test_case',108,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:42:30'),(84,3,'zhaosz','管理员','删除测试用例','删除测试用例 [大胜达-Copy]','test_case',107,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:42:32'),(85,3,'zhaosz','管理员','删除测试用例','删除测试用例 [大胜达-Copy2]','test_case',106,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:42:35'),(86,3,'zhaosz','管理员','删除测试用例','删除测试用例 [大胜达-Copy]','test_case',105,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:42:38'),(87,3,'zhaosz','管理员','删除测试用例','删除测试用例 [测试123-Copy5555555]','test_case',104,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:42:40'),(88,3,'zhaosz','管理员','删除测试用例','删除测试用例 [测试123-Copy222]','test_case',103,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:42:42'),(89,3,'zhaosz','管理员','删除测试用例','删除测试用例 [测试123-Copy222]','test_case',102,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:42:44'),(90,3,'zhaosz','管理员','删除测试用例','删除测试用例 [测试123-Copy]','test_case',101,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:42:47'),(91,3,'zhaosz','管理员','删除测试用例','删除测试用例 [netrx wrr测试-Clone222-Copy]','test_case',100,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:42:49'),(92,3,'zhaosz','管理员','删除测试用例','删除测试用例 [大胜达-Copy333333-Copy4444]','test_case',114,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:43:46'),(93,3,'zhaosz','管理员','删除测试用例','删除测试用例 [大胜达-Copy333333-Copy]','test_case',116,'::1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36','2026-04-07 04:43:50');
/*!40000 ALTER TABLE `activity_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ai_config`
--

DROP TABLE IF EXISTS `ai_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `config_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `config_value` text COLLATE utf8mb4_unicode_ci,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `config_key` (`config_key`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ai_config`
--

LOCK TABLES `ai_config` WRITE;
/*!40000 ALTER TABLE `ai_config` DISABLE KEYS */;
INSERT INTO `ai_config` VALUES (1,'ai_enabled','true','是否启用AI功能',NULL,'2026-03-23 14:43:59'),(2,'default_model_id','','默认AI模型ID',NULL,'2026-03-23 14:43:59');
/*!40000 ALTER TABLE `ai_config` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ai_models`
--

DROP TABLE IF EXISTS `ai_models`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_models` (
  `id` int NOT NULL AUTO_INCREMENT,
  `model_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `provider` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `api_key` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `endpoint` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `model_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_default` tinyint(1) DEFAULT '0',
  `is_enabled` tinyint(1) DEFAULT '1',
  `description` text COLLATE utf8mb4_unicode_ci,
  `created_by` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `user_id` int DEFAULT NULL COMMENT '用户ID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `model_id` (`model_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ai_models`
--

LOCK TABLES `ai_models` WRITE;
/*!40000 ALTER TABLE `ai_models` DISABLE KEYS */;
INSERT INTO `ai_models` VALUES (1,'deepseek-default','DeepSeek','deepseek','','https://api.deepseek.com/v1/chat/completions','deepseek-chat',1,1,'DeepSeek大模型','admin','2026-03-23 14:43:59','2026-03-31 06:06:11',1),(2,'openai-default','OpenAI','openai','','https://api.openai.com/v1/chat/completions','gpt-3.5-turbo',0,1,'OpenAI大模型','admin','2026-03-23 14:43:59','2026-03-31 06:06:11',1),(3,'zhipu-default','智谱AI','zhipu','','https://open.bigmodel.cn/api/paas/v4/chat/completions','glm-4',0,1,'智谱AI大模型','admin','2026-03-23 14:43:59','2026-03-31 06:06:11',1),(4,'sadad','dasdas','deepseek','ddddddadsadasad','https:\\xxxx','deepseek',0,1,'','cccc','2026-03-31 06:21:17','2026-03-31 06:21:17',4),(5,'dasdada','dsdasd','deepseek','ssssss','sadasdasd','dasdasd',1,1,'','cccc','2026-03-31 07:27:59','2026-03-31 07:27:59',4);
/*!40000 ALTER TABLE `ai_models` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ai_skills`
--

DROP TABLE IF EXISTS `ai_skills`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_skills` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '技能标识名，如 analyze_pass_rate',
  `display_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '技能显示名称',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '技能描述',
  `definition` json DEFAULT NULL COMMENT 'LLM Tool Schema 定义',
  `execute_code` text COLLATE utf8mb4_unicode_ci COMMENT 'Node.js 可执行的 JS 脚本',
  `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'general' COMMENT '技能分类',
  `is_enabled` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `is_system` tinyint(1) DEFAULT '0' COMMENT '是否系统内置',
  `created_by` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_public` tinyint(1) DEFAULT '1' COMMENT '是否公开',
  `creator_id` int DEFAULT NULL COMMENT '创建者ID',
  `updater_id` int DEFAULT NULL COMMENT '更新者ID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `idx_name` (`name`),
  KEY `idx_enabled` (`is_enabled`),
  KEY `idx_category` (`category`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ai_skills`
--

LOCK TABLES `ai_skills` WRITE;
/*!40000 ALTER TABLE `ai_skills` DISABLE KEYS */;
INSERT INTO `ai_skills` VALUES (1,'query_test_statistics','查询测试统计','查询指定项目的测试用例统计数据，包括总数、通过率等','{\"type\": \"function\", \"function\": {\"name\": \"query_test_statistics\", \"parameters\": {\"type\": \"object\", \"required\": [\"project_id\"], \"properties\": {\"project_id\": {\"type\": \"string\", \"description\": \"项目ID\"}}}, \"description\": \"查询指定项目的测试统计数据，返回用例总数、通过率等信息\"}}','const [rows] = await dbPool.execute(\"SELECT COUNT(*) as total, SUM(CASE WHEN status = \'Pass\' THEN 1 ELSE 0 END) as passed FROM test_cases tc JOIN test_case_projects tcp ON tc.id = tcp.test_case_id WHERE tcp.project_id = ?\", [args.project_id]); const result = rows[0]; return { total: result.total, passed: result.passed, passRate: result.total > 0 ? ((result.passed / result.total) * 100).toFixed(2) + \"%\" : \"0%\" };','statistics',1,1,NULL,'2026-03-23 14:43:59','2026-03-23 14:43:59',1,NULL,NULL),(2,'query_user_tasks','查询用户任务','查询指定用户负责的测试任务列表','{\"type\": \"function\", \"function\": {\"name\": \"query_user_tasks\", \"parameters\": {\"type\": \"object\", \"required\": [\"username\"], \"properties\": {\"username\": {\"type\": \"string\", \"description\": \"用户名\"}}}, \"description\": \"查询指定用户负责的测试任务，返回任务列表\"}}','const [rows] = await dbPool.execute(\"SELECT tp.id, tp.name, tp.status, tp.pass_rate FROM test_plans tp WHERE tp.owner = ? ORDER BY tp.created_at DESC LIMIT 10\", [args.username]); return rows;','task',1,1,NULL,'2026-03-23 14:43:59','2026-03-23 14:43:59',1,NULL,NULL),(3,'analyze_module_coverage','分析模块覆盖','分析指定模块的测试用例覆盖情况','{\"type\": \"function\", \"function\": {\"name\": \"analyze_module_coverage\", \"parameters\": {\"type\": \"object\", \"required\": [\"module_name\"], \"properties\": {\"module_name\": {\"type\": \"string\", \"description\": \"模块名称（支持模糊匹配）\"}}}, \"description\": \"分析指定模块的测试覆盖情况\"}}','const [modules] = await dbPool.execute(\"SELECT id, name FROM modules WHERE name LIKE ?\", [\"%\" + args.module_name + \"%\"]); if (modules.length === 0) return { error: \"未找到匹配的模块\" }; const results = []; for (const mod of modules) { const [level1] = await dbPool.execute(\"SELECT COUNT(*) as count FROM level1_points WHERE module_id = ?\", [mod.id]); const [cases] = await dbPool.execute(\"SELECT COUNT(*) as count FROM test_cases tc JOIN level1_points l1 ON tc.level1_id = l1.id WHERE l1.module_id = ?\", [mod.id]); results.push({ moduleName: mod.name, level1Count: level1[0].count, caseCount: cases[0].count }); } return results;','analysis',1,1,NULL,'2026-03-23 14:43:59','2026-03-23 14:43:59',1,NULL,NULL),(4,'generate_test_report','生成测试报告','根据项目数据生成专业的测试报告，支持概要和详细两种模式','{\"type\": \"function\", \"function\": {\"name\": \"generate_test_report\", \"parameters\": {\"type\": \"object\", \"required\": [\"project_name\"], \"properties\": {\"report_type\": {\"enum\": [\"summary\", \"detailed\"], \"type\": \"string\", \"description\": \"报告类型：summary（概要）或 detailed（详细）\"}, \"template_id\": {\"type\": \"string\", \"description\": \"模板ID（可选，不指定则使用默认模板）\"}, \"project_name\": {\"type\": \"string\", \"description\": \"项目名称（支持模糊匹配）\"}}}, \"description\": \"根据项目数据生成专业的测试报告，支持指定模板\"}}','const fs = require(\'fs\'); const path = require(\'path\'); const projectName = args.project_name; const templateId = args.template_id; const reportType = args.report_type || \'summary\'; const [projects] = await dbPool.execute(\"SELECT id, name, code FROM projects WHERE name LIKE ?\", [\"%\" + projectName + \"%\"]); if (projects.length === 0) return { error: \"未找到匹配的项目: \" + projectName }; const project = projects[0]; const [testPlans] = await dbPool.execute(\"SELECT id, name, status, pass_rate, total_cases, tested_cases, owner, created_at FROM test_plans WHERE project = ? ORDER BY created_at DESC\", [project.name]); let totalCases = 0, testedCases = 0, passedCases = 0, failedCases = 0, blockedCases = 0; const planDetails = []; for (const plan of testPlans) { const [planCases] = await dbPool.execute(\"SELECT status, COUNT(*) as count FROM test_plan_cases WHERE plan_id = ? GROUP BY status\", [plan.id]); let planPassed = 0, planFailed = 0, planBlocked = 0, planPending = 0; for (const pc of planCases) { if (pc.status === \'Pass\') planPassed = pc.count; else if (pc.status === \'Fail\') planFailed = pc.count; else if (pc.status === \'Block\') planBlocked = pc.count; else planPending = pc.count; } const planTotal = planPassed + planFailed + planBlocked + planPending; totalCases += planTotal; testedCases += (planPassed + planFailed + planBlocked); passedCases += planPassed; failedCases += planFailed; blockedCases += planBlocked; planDetails.push({ name: plan.name, status: plan.status, total: planTotal, passed: planPassed, failed: planFailed, blocked: planBlocked, passRate: planTotal > 0 ? ((planPassed / (planPassed + planFailed + planBlocked)) * 100).toFixed(1) : 0 }); } const passRate = testedCases > 0 ? ((passedCases / testedCases) * 100).toFixed(1) : 0; const progress = totalCases > 0 ? ((testedCases / totalCases) * 100).toFixed(1) : 0; let template = \'\'; let templateName = \'默认模板\'; try { let templateQuery = \'SELECT file_path, name FROM report_templates WHERE is_default = TRUE LIMIT 1\'; let queryParams = []; if (templateId) { templateQuery = \'SELECT file_path, name FROM report_templates WHERE id = ?\'; queryParams = [templateId]; } const [templates] = await dbPool.execute(templateQuery, queryParams); if (templates.length > 0 && fs.existsSync(templates[0].file_path)) { template = fs.readFileSync(templates[0].file_path, \'utf8\'); templateName = templates[0].name; } else { template = \'# {{项目名称}} 测试报告\\n\\n## 测试概览\\n- 项目名称: {{项目名称}}\\n- 总用例数: {{总用例数}}\\n- 通过率: {{通过率}}\\n\\n## 详细数据\\n{{详细数据}}\\n\\n---\\n*本报告由 xTest AI 自动生成*\'; } } catch (e) { template = \'# {{项目名称}} 测试报告\\n\\n## 测试概览\\n- 项目名称: {{项目名称}}\\n- 总用例数: {{总用例数}}\\n- 通过率: {{通过率}}\\n\\n## 详细数据\\n{{详细数据}}\\n\\n---\\n*本报告由 xTest AI 自动生成*\'; } return { type: \'report_generation\', project: { id: project.id, name: project.name, code: project.code }, statistics: { totalCases, testedCases, passedCases, failedCases, blockedCases, pendingCases: totalCases - testedCases, passRate: passRate + \'%\', progress: progress + \'%\' }, testPlans: planDetails, template: template, templateName: templateName, instructions: \"请根据以上数据，严格按照模板格式生成一份专业的测试报告。要求：1. 用专业自然的语言填充模板中的占位符；2. 表格数据要准确；3. 风险项要具体分析；4. 改进建议要切实可行。\" };','report',1,1,NULL,'2026-03-23 14:43:59','2026-03-23 14:43:59',1,NULL,NULL);
/*!40000 ALTER TABLE `ai_skills` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `case_execution_records`
--

DROP TABLE IF EXISTS `case_execution_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `case_execution_records` (
  `id` int NOT NULL AUTO_INCREMENT,
  `case_id` int NOT NULL COMMENT '测试用例ID',
  `record_type` enum('defect','other') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '记录类型: defect-缺陷, other-其他',
  `bug_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Bug ID',
  `bug_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Bug类型',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '详细描述',
  `images` json DEFAULT NULL COMMENT '图片列表JSON数组',
  `creator` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '创建人',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_case_id` (`case_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='测试用例执行记录表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `case_execution_records`
--

LOCK TABLES `case_execution_records` WRITE;
/*!40000 ALTER TABLE `case_execution_records` DISABLE KEYS */;
/*!40000 ALTER TABLE `case_execution_records` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `case_libraries`
--

DROP TABLE IF EXISTS `case_libraries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `case_libraries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `creator` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `module_count` int DEFAULT '0',
  `config` text COLLATE utf8mb4_unicode_ci,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `case_libraries`
--

LOCK TABLES `case_libraries` WRITE;
/*!40000 ALTER TABLE `case_libraries` DISABLE KEYS */;
INSERT INTO `case_libraries` VALUES (1,'U12芯片测试','zhaosz','2026-03-24 05:12:53',0,'','2026-03-24 05:12:53'),(2,'芯片测试','admin','2026-03-26 03:24:30',0,'','2026-03-26 03:24:30');
/*!40000 ALTER TABLE `case_libraries` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `case_library_cases`
--

DROP TABLE IF EXISTS `case_library_cases`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `case_library_cases` (
  `id` int NOT NULL AUTO_INCREMENT,
  `library_id` int NOT NULL,
  `case_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_library_case` (`library_id`,`case_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `case_library_cases`
--

LOCK TABLES `case_library_cases` WRITE;
/*!40000 ALTER TABLE `case_library_cases` DISABLE KEYS */;
/*!40000 ALTER TABLE `case_library_cases` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `case_reviewers`
--

DROP TABLE IF EXISTS `case_reviewers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `case_reviewers` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `case_id` int NOT NULL COMMENT '测试用例ID',
  `reviewer_id` int NOT NULL COMMENT '评审人ID',
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_unicode_ci DEFAULT 'pending' COMMENT '评审状态: pending-待评审, approved-已通过, rejected-已拒绝',
  `comment` text COLLATE utf8mb4_unicode_ci COMMENT '评审意见',
  `reviewed_at` timestamp NULL DEFAULT NULL COMMENT '评审时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_case_reviewer` (`case_id`,`reviewer_id`),
  KEY `idx_case_id` (`case_id`),
  KEY `idx_reviewer_id` (`reviewer_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `case_reviewers_ibfk_1` FOREIGN KEY (`case_id`) REFERENCES `test_cases` (`id`) ON DELETE CASCADE,
  CONSTRAINT `case_reviewers_ibfk_2` FOREIGN KEY (`reviewer_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用例评审人表（多人评审）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `case_reviewers`
--

LOCK TABLES `case_reviewers` WRITE;
/*!40000 ALTER TABLE `case_reviewers` DISABLE KEYS */;
INSERT INTO `case_reviewers` VALUES (2,43,3,'approved','步骤清晰','2026-04-01 12:08:46','2026-04-01 10:33:09'),(3,43,4,'approved','可直接执行','2026-04-02 15:00:46','2026-04-01 10:33:09'),(4,38,3,'approved','可直接执行','2026-04-01 15:13:56','2026-04-01 15:05:53'),(5,24,3,'approved','','2026-04-02 06:25:21','2026-04-02 05:20:08'),(6,25,3,'approved','','2026-04-02 07:54:02','2026-04-02 05:20:08'),(7,26,3,'approved','可直接执行','2026-04-02 07:54:55','2026-04-02 05:20:08'),(8,27,3,'pending',NULL,NULL,'2026-04-02 05:20:08'),(9,28,3,'approved','可直接执行','2026-04-02 06:25:16','2026-04-02 05:20:08'),(10,29,3,'pending',NULL,NULL,'2026-04-02 05:20:08'),(11,30,3,'pending',NULL,NULL,'2026-04-02 05:20:08'),(12,31,3,'pending',NULL,NULL,'2026-04-02 05:20:08'),(13,32,3,'pending',NULL,NULL,'2026-04-02 05:20:08'),(14,33,3,'pending',NULL,NULL,'2026-04-02 05:20:08'),(15,34,3,'pending',NULL,NULL,'2026-04-02 05:20:08'),(16,35,3,'pending',NULL,NULL,'2026-04-02 05:20:08'),(17,36,3,'pending',NULL,NULL,'2026-04-02 05:20:08'),(18,37,3,'pending',NULL,NULL,'2026-04-02 05:20:08'),(19,99,3,'pending',NULL,NULL,'2026-04-02 05:20:08'),(20,44,4,'approved','可直接执行','2026-04-02 13:56:57','2026-04-02 13:48:34'),(21,44,3,'pending',NULL,NULL,'2026-04-02 13:48:34'),(22,45,4,'approved','可直接执行','2026-04-02 13:59:27','2026-04-02 13:48:34'),(23,45,3,'pending',NULL,NULL,'2026-04-02 13:48:34'),(24,46,4,'approved','可直接执行','2026-04-03 02:33:14','2026-04-02 13:48:34'),(25,46,3,'pending',NULL,NULL,'2026-04-02 13:48:34');
/*!40000 ALTER TABLE `case_reviewers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `chips`
--

DROP TABLE IF EXISTS `chips`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chips` (
  `id` int NOT NULL AUTO_INCREMENT,
  `chip_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `chip_id` (`chip_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `chips`
--

LOCK TABLES `chips` WRITE;
/*!40000 ALTER TABLE `chips` DISABLE KEYS */;
INSERT INTO `chips` VALUES (1,'chip1','芯片1','默认测试芯片1','2026-03-23 14:43:59','2026-03-23 14:43:59'),(2,'chip2','芯片2','默认测试芯片2','2026-03-23 14:43:59','2026-03-23 14:43:59'),(3,'chip3','芯片3','默认测试芯片3','2026-03-23 14:43:59','2026-03-23 14:43:59');
/*!40000 ALTER TABLE `chips` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `email_config`
--

DROP TABLE IF EXISTS `email_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `config_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '配置名称',
  `email_type` enum('smtp','self_hosted') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'smtp' COMMENT '邮件类型: smtp-企业邮箱, self_hosted-自建服务器',
  `smtp_host` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'SMTP服务器地址',
  `smtp_port` int DEFAULT '587' COMMENT 'SMTP端口',
  `smtp_secure` tinyint(1) DEFAULT '0' COMMENT '是否使用SSL/TLS',
  `smtp_user` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'SMTP用户名',
  `smtp_password` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'SMTP密码(加密存储)',
  `sender_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '发件人邮箱',
  `sender_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '发件人名称',
  `self_hosted_api_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '自建服务器API地址',
  `self_hosted_api_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '自建服务器API密钥',
  `is_default` tinyint(1) DEFAULT '0' COMMENT '是否默认配置',
  `is_enabled` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `daily_limit` int DEFAULT '500' COMMENT '每日发送限制',
  `sent_today` int DEFAULT '0' COMMENT '今日已发送数量',
  `last_sent_date` date DEFAULT NULL COMMENT '最后发送日期',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_is_default` (`is_default`),
  KEY `idx_is_enabled` (`is_enabled`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `email_config`
--

LOCK TABLES `email_config` WRITE;
/*!40000 ALTER TABLE `email_config` DISABLE KEYS */;
INSERT INTO `email_config` VALUES (1,'企业邮箱SMTP','smtp','smtp.exmail.qq.com',465,1,NULL,NULL,NULL,'xTest测试管理系统',NULL,NULL,1,0,500,0,NULL,'2026-03-23 14:43:59','2026-03-23 14:43:59'),(2,'自建邮件服务器','self_hosted',NULL,NULL,0,NULL,NULL,NULL,'xTest测试管理系统',NULL,NULL,0,0,500,0,NULL,'2026-03-23 14:43:59','2026-03-23 14:43:59');
/*!40000 ALTER TABLE `email_config` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `email_logs`
--

DROP TABLE IF EXISTS `email_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `config_id` int DEFAULT NULL COMMENT '使用的配置ID',
  `recipient_email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '收件人邮箱',
  `recipient_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '收件人名称',
  `subject` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '邮件主题',
  `email_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '邮件类型: verification, notification, report等',
  `status` enum('pending','sent','failed') COLLATE utf8mb4_unicode_ci DEFAULT 'pending' COMMENT '发送状态',
  `error_message` text COLLATE utf8mb4_unicode_ci COMMENT '错误信息',
  `sent_at` timestamp NULL DEFAULT NULL COMMENT '发送时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `config_id` (`config_id`),
  KEY `idx_recipient_email` (`recipient_email`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `email_logs_ibfk_1` FOREIGN KEY (`config_id`) REFERENCES `email_config` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `email_logs`
--

LOCK TABLES `email_logs` WRITE;
/*!40000 ALTER TABLE `email_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `email_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `environments`
--

DROP TABLE IF EXISTS `environments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `environments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `env_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `creator` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `env_id` (`env_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1569 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `environments`
--

LOCK TABLES `environments` WRITE;
/*!40000 ALTER TABLE `environments` DISABLE KEYS */;
INSERT INTO `environments` VALUES (46,'ENV-1774329527427-472','UML','','zhaosz','2026-03-24 05:18:47','2026-03-24 05:18:47'),(47,'ENV-1774329533270-214','EMUL','','zhaosz','2026-03-24 05:18:53','2026-03-24 05:18:53'),(48,'ENV_001','开发环境','开发人员使用的环境','admin','2026-03-29 15:12:55','2026-03-29 15:12:55'),(49,'ENV_002','测试环境','测试人员使用的环境','admin','2026-03-29 15:12:55','2026-03-29 15:12:55'),(50,'ENV_003','生产环境','最终用户使用的环境','admin','2026-03-29 15:12:55','2026-03-29 15:12:55');
/*!40000 ALTER TABLE `environments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `forum_comments`
--

DROP TABLE IF EXISTS `forum_comments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `forum_comments` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '评论ID',
  `comment_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '评论唯一标识',
  `post_id` int NOT NULL COMMENT '帖子ID',
  `author_id` int NOT NULL COMMENT '评论者ID',
  `parent_id` int DEFAULT NULL COMMENT '父评论ID',
  `reply_to_id` int DEFAULT NULL COMMENT '回复的评论ID',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '评论内容',
  `content_html` text COLLATE utf8mb4_unicode_ci COMMENT '评论内容HTML渲染结果',
  `like_count` int DEFAULT '0' COMMENT '点赞数量',
  `is_anonymous` tinyint(1) DEFAULT '0' COMMENT '是否匿名',
  `status` enum('normal','hidden','deleted') COLLATE utf8mb4_unicode_ci DEFAULT 'normal' COMMENT '评论状态',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `comment_id` (`comment_id`),
  KEY `idx_post_id` (`post_id`),
  KEY `idx_author_id` (`author_id`),
  KEY `idx_parent_id` (`parent_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `forum_comments`
--

LOCK TABLES `forum_comments` WRITE;
/*!40000 ALTER TABLE `forum_comments` DISABLE KEYS */;
/*!40000 ALTER TABLE `forum_comments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `forum_likes`
--

DROP TABLE IF EXISTS `forum_likes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `forum_likes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL COMMENT '用户ID',
  `target_type` enum('post','comment') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '点赞目标类型',
  `target_id` int NOT NULL COMMENT '目标ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_target` (`user_id`,`target_type`,`target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `forum_likes`
--

LOCK TABLES `forum_likes` WRITE;
/*!40000 ALTER TABLE `forum_likes` DISABLE KEYS */;
/*!40000 ALTER TABLE `forum_likes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `forum_post_tags`
--

DROP TABLE IF EXISTS `forum_post_tags`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `forum_post_tags` (
  `id` int NOT NULL AUTO_INCREMENT,
  `post_id` int NOT NULL COMMENT '帖子ID',
  `tag_id` int NOT NULL COMMENT '标签ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_post_tag` (`post_id`,`tag_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `forum_post_tags`
--

LOCK TABLES `forum_post_tags` WRITE;
/*!40000 ALTER TABLE `forum_post_tags` DISABLE KEYS */;
/*!40000 ALTER TABLE `forum_post_tags` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `forum_posts`
--

DROP TABLE IF EXISTS `forum_posts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `forum_posts` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '帖子ID',
  `post_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '帖子唯一标识',
  `author_id` int NOT NULL COMMENT '作者ID',
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '帖子标题',
  `content` longtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '帖子内容',
  `content_html` longtext COLLATE utf8mb4_unicode_ci COMMENT '帖子内容HTML渲染结果',
  `view_count` int DEFAULT '0' COMMENT '浏览次数',
  `comment_count` int DEFAULT '0' COMMENT '评论数量',
  `like_count` int DEFAULT '0' COMMENT '点赞数量',
  `is_pinned` tinyint(1) DEFAULT '0' COMMENT '是否置顶',
  `is_locked` tinyint(1) DEFAULT '0' COMMENT '是否锁定',
  `is_anonymous` tinyint(1) DEFAULT '0' COMMENT '是否匿名',
  `status` enum('normal','hidden','deleted') COLLATE utf8mb4_unicode_ci DEFAULT 'normal' COMMENT '帖子状态',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `post_id` (`post_id`),
  KEY `idx_author_id` (`author_id`),
  KEY `idx_status` (`status`),
  KEY `idx_is_pinned` (`is_pinned`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `forum_posts`
--

LOCK TABLES `forum_posts` WRITE;
/*!40000 ALTER TABLE `forum_posts` DISABLE KEYS */;
INSERT INTO `forum_posts` VALUES (1,'POST-32bc20cd-7740-44bd-99ac-8a0a46bbe52a',4,'欢迎使用xtest社区','欢迎使用xtest社区。\n\n```\n## 代码库字符长度限制分析报告\n\n### 一、前端 HTML maxlength 属性限制\n\n| 文件位置 | 字段 | 限制值 | 说明 |\n|---------|------|--------|------|\n| [index.html:3027](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L3027) | 测试计划名称 | 64字符 | `maxlength=\"64\"` |\n| [index.html:3400](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L3400) | 模块名称 | 32字符 | `maxlength=\"32\"` |\n| [index.html:3414](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L3414) | 克隆模块名称 | 32字符 | `maxlength=\"32\"` |\n| [index.html:3509](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L3509) | 编辑模块名称 | 32字符 | `maxlength=\"32\"` |\n| [index.html:3536](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L3536) | 子模块名称 | 32字符 | `maxlength=\"32\"` |\n| [index.html:3933](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L3933) | 一级测试点名称 | 64字符 | `maxlength=\"64\"` |\n| [index.html:4021](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L4021) | 用例库名称 | 64字符 | `maxlength=\"64\"` |\n| [index.html:4040](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L4040) | 克隆用例库名称 | 64字符 | `maxlength=\"64\"` |\n| [index.html:198](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L198) | 注册密码 | 最少6位 | `minlength=\"6\"` |\n| [script.js:9942](file:///Users/zhao/Desktop/my_projects/xtest/script.js#L9942) | 备注输入框 | 256字符 | `maxlength=\"256\"` |\n| [batch-create-cases.js:437](file:///Users/zhao/Desktop/my_projects/xtest/public/js/batch-create-cases.js#L437) | 批量创建用例名称 | 100字符 | `maxlength=\"100\"` |\n| [batch-create-cases.js:456](file:///Users/zhao/Desktop/my_projects/xtest/public/js/batch-create-cases.js#L456) | 批量创建负责人 | 50字符 | `maxlength=\"50\"` |\n\n---\n\n### 二、前端 JavaScript 长度验证逻辑\n\n| 文件位置 | 验证内容 | 限制值 | 代码片段 |\n|---------|---------|--------|----------|\n| [script.js:4695-4696](file:///Users/zhao/Desktop/my_projects/xtest/script.js#L4695-L4696) | 模块名称 | 32字符 | `if (newName.length > 32)` |\n| [script.js:12379-12380](file:///Users/zhao/Desktop/my_projects/xtest/script.js#L12379-L12380) | 新密码 | 最少6位 | `if (newPassword.length < 6)` |\n| [script.js:15828](file:///Users/zhao/Desktop/my_projects/xtest/script.js#L15828) | 用例库名称默认 | 64字符 | `const maxLength = input.maxLength > 0 ? input.maxLength : 64` |\n| [script.js:19490-19492](file:///Users/zhao/Desktop/my_projects/xtest/script.js#L19490-L19492) | 文本截断函数 | 动态 | `function truncateText(text, maxLength)` |\n\n---\n\n### 三、后端 Excel 导入字段长度验证\n\n在 [routes/excel.js:818-830](file:///Users/zhao/Desktop/my_projects/xtest/routes/excel.js#L818-L830) 定义了详细的字段长度限制：\n\n```javascript\nconst fieldLengths = {\n  name: { max: 500, label: \'用例名称\' },\n  priority: { max: 50, label: \'优先级\' },\n  type: { max: 100, label: \'用例类型\' },\n  precondition: { max: 2000, label: \'前置条件\' },\n  purpose: { max: 2000, label: \'测试目的\' },\n  steps: { max: 5000, label: \'测试步骤\' },\n  expected: { max: 2000, label: \'预期结果\' },\n  owner: { max: 100, label: \'执行人\' },\n  status: { max: 50, label: \'维护状态\' },\n  key_config: { max: 2000, label: \'关键配置\' },\n  remark: { max: 2000, label: \'备注\' }\n};\n```\n\n验证逻辑在 [routes/excel.js:849](file:///Users/zhao/Desktop/my_projects/xtest/routes/excel.js#L849)：\n\n```javascript\nif (value && value.length > config.max) {\n  // 跳过超长行并记录原因\n}\n```\n\n---\n\n### 四、数据库字段长度限制\n\n#### 1. 用户表\n\n\n| 字段     | 类型         | 限制    |\n| -------- | ------------ | ------- |\n| username | VARCHAR(50)  | 50字符  |\n| password | VARCHAR(255) | 255字符 |\n| role     | VARCHAR(20)  | 20字符  |\n| email    | VARCHAR(100) | 100字符 |\n\n#### 2. 模块表\n\n\n| 字段      | 类型         | 限制    |\n| --------- | ------------ | ------- |\n| module_id | VARCHAR(50)  | 50字符  |\n| name      | VARCHAR(100) | 100字符 |\n\n#### 3. 一级测试点表 (level1_points)\n\n\n| 字段      | 类型         | 限制    |\n| --------- | ------------ | ------- |\n| name      | VARCHAR(100) | 100字符 |\n| test_type | VARCHAR(50)  | 50字符  |\n\n#### 4. 芯片表\n\n\n| 字段    | 类型         | 限制    |\n| ------- | ------------ | ------- |\n| chip_id | VARCHAR(50)  | 50字符  |\n| name    | VARCHAR(100) | 100字符 |\n\n#### 5. 二级测试点表 (level2_points)\n\n\n| 字段             | 类型         | 限制    |\n| ---------------- | ------------ | ------- |\n| name             | VARCHAR(100) | 100字符 |\n| test_environment | VARCHAR(255) | 255字符 |\n| case_name        | VARCHAR(100) | 100字符 |\n\n#### 6. 历史记录表\n\n\n| 字段    | 类型        | 限制   |\n| ------- | ----------- | ------ |\n| user    | VARCHAR(50) | 50字符 |\n| action  | VARCHAR(50) | 50字符 |\n| version | VARCHAR(20) | 20字符 |\n\n#### 7. 测试点芯片表 (testpoint_chips)\n\n\n| 字段          | 类型         | 限制    |\n| ------------- | ------------ | ------- |\n| chip_sequence | VARCHAR(255) | 255字符 |\n\n#### 8. 测试点状态表 (testpoint_status)\n\n\n| 字段        | 类型        | 限制   |\n| ----------- | ----------- | ------ |\n| test_result | VARCHAR(20) | 20字符 |\n\n#### 9. 历史快照表 (history_snapshots)\n\n\n| 字段        | 类型        | 限制   |\n| ----------- | ----------- | ------ |\n| entity_type | VARCHAR(50) | 50字符 |\n| version     | VARCHAR(20) | 20字符 |\n| user        | VARCHAR(50) | 50字符 |\n| action      | VARCHAR(50) | 50字符 |\n\n#### 10. 测试计划表 (test_plans)\n\n\n| 字段       | 类型         | 限制    |\n| ---------- | ------------ | ------- |\n| name       | VARCHAR(100) | 100字符 |\n| owner      | VARCHAR(50)  | 50字符  |\n| status     | VARCHAR(20)  | 20字符  |\n| test_phase | VARCHAR(50)  | 50字符  |\n| project    | VARCHAR(100) | 100字符 |\n| iteration  | VARCHAR(50)  | 50字符  |\n\n#### 11. 测试报告表 (test_reports)\n\n\n| 字段        | 类型         | 限制    |\n| ----------- | ------------ | ------- |\n| name        | VARCHAR(100) | 100字符 |\n| creator     | VARCHAR(50)  | 50字符  |\n| project     | VARCHAR(100) | 100字符 |\n| iteration   | VARCHAR(50)  | 50字符  |\n| report_type | VARCHAR(20)  | 20字符  |\n| status      | VARCHAR(20)  | 20字符  |\n| job_id      | VARCHAR(100) | 100字符 |\n\n#### 12. 项目表\n\n\n| 字段 | 类型         | 限制    |\n| ---- | ------------ | ------- |\n| name | VARCHAR(100) | 100字符 |\n| code | VARCHAR(50)  | 50字符  |\n\n#### 13. 用例库表 (case_libraries)\n\n\n| 字段    | 类型         | 限制    |\n| ------- | ------------ | ------- |\n| name    | VARCHAR(100) | 100字符 |\n| creator | VARCHAR(50)  | 50字符  |\n\n#### 14. 测试用例表 (test_cases)\n\n\n| 字段         | 类型         | 限制    |\n| ------------ | ------------ | ------- |\n| case_id      | VARCHAR(50)  | 50字符  |\n| name         | VARCHAR(100) | 100字符 |\n| priority     | VARCHAR(20)  | 20字符  |\n| type         | VARCHAR(50)  | 50字符  |\n| precondition | TEXT         | 无限制  |\n| purpose      | TEXT         | 无限制  |\n| steps        | TEXT         | 无限制  |\n| expected     | TEXT         | 无限制  |\n| creator      | VARCHAR(50)  | 50字符  |\n| owner        | VARCHAR(50)  | 50字符  |\n| remark       | TEXT         | 无限制  |\n| key_config   | TEXT         | 无限制  |\n| method       | VARCHAR(50)  | 50字符  |\n| status       | VARCHAR(50)  | 50字符  |\n\n#### 15. 测试用例项目关联表 (test_case_projects)\n\n\n| 字段   | 类型         | 限制    |\n| ------ | ------------ | ------- |\n| owner  | VARCHAR(50)  | 50字符  |\n| remark | VARCHAR(128) | 128字符 |\n\n#### 16. 环境表\n\n\n| 字段    | 类型         | 限制    |\n| ------- | ------------ | ------- |\n| env_id  | VARCHAR(50)  | 50字符  |\n| name    | VARCHAR(100) | 100字符 |\n| creator | VARCHAR(50)  | 50字符  |\n\n#### 17. 测试方式表 (test_methods)\n\n\n| 字段      | 类型         | 限制    |\n| --------- | ------------ | ------- |\n| method_id | VARCHAR(50)  | 50字符  |\n| name      | VARCHAR(100) | 100字符 |\n| creator   | VARCHAR(50)  | 50字符  |\n\n#### 18. 测试类型表 (test_types)\n\n\n| 字段    | 类型         | 限制    |\n| ------- | ------------ | ------- |\n| type_id | VARCHAR(50)  | 50字符  |\n| name    | VARCHAR(100) | 100字符 |\n| creator | VARCHAR(50)  | 50字符  |\n\n#### 19. 测试阶段表 (test_phases)\n\n\n| 字段     | 类型         | 限制    |\n| -------- | ------------ | ------- |\n| phase_id | VARCHAR(50)  | 50字符  |\n| name     | VARCHAR(100) | 100字符 |\n| creator  | VARCHAR(50)  | 50字符  |\n\n#### 20. 测试软件表 (test_softwares)\n\n\n| 字段        | 类型         | 限制    |\n| ----------- | ------------ | ------- |\n| software_id | VARCHAR(50)  | 50字符  |\n| name        | VARCHAR(100) | 100字符 |\n| creator     | VARCHAR(50)  | 50字符  |\n\n#### 21. 优先级表 (test_priorities)\n\n\n| 字段        | 类型         | 限制    |\n| ----------- | ------------ | ------- |\n| priority_id | VARCHAR(50)  | 50字符  |\n| name        | VARCHAR(100) | 100字符 |\n| creator     | VARCHAR(50)  | 50字符  |\n\n#### 22. AI配置表 (ai_config)\n\n\n| 字段        | 类型         | 限制    |\n| ----------- | ------------ | ------- |\n| config_key  | VARCHAR(100) | 100字符 |\n| description | VARCHAR(255) | 255字符 |\n| updated_by  | VARCHAR(50)  | 50字符  |\n\n#### 23. AI模型表 (ai_models)\n\n\n| 字段       | 类型         | 限制    |\n| ---------- | ------------ | ------- |\n| model_id   | VARCHAR(50)  | 50字符  |\n| name       | VARCHAR(100) | 100字符 |\n| provider   | VARCHAR(50)  | 50字符  |\n| endpoint   | VARCHAR(500) | 500字符 |\n| model_name | VARCHAR(100) | 100字符 |\n| created_by | VARCHAR(50)  | 50字符  |\n\n#### 24. AI技能表 (ai_skills)\n\n\n| 字段         | 类型         | 限制    |\n| ------------ | ------------ | ------- |\n| name         | VARCHAR(100) | 100字符 |\n| display_name | VARCHAR(200) | 200字符 |\n| category     | VARCHAR(50)  | 50字符  |\n| created_by   | VARCHAR(50)  | 50字符  |\n\n#### 25. 报告模板表 (report_templates)\n\n\n| 字段       | 类型         | 限制    |\n| ---------- | ------------ | ------- |\n| name       | VARCHAR(200) | 200字符 |\n| file_path  | VARCHAR(500) | 500字符 |\n| file_type  | VARCHAR(20)  | 20字符  |\n| created_by | VARCHAR(50)  | 50字符  |\n| updated_by | VARCHAR(50)  | 50字符  |\n\n#### 26. 论坛帖子表 (forum_posts)\n\n\n| 字段         | 类型     | 限制   |\n| ------------ | -------- | ------ |\n| content      | LONGTEXT | 无限制 |\n| content_html | LONGTEXT | 无限制 |\n\n---\n\n### 五、潜在问题与不一致性\n\n1. **前端与数据库不一致**：\n\n   - 模块名称：前端限制32字符，数据库允许100字符\n   - 用例库名称：前端限制64字符，数据库允许100字符\n   - 用例名称：批量创建前端限制100字符，Excel导入验证允许500字符，数据库只允许100字符\n2. **汉字与字符**：\n\n   - 所有长度限制都是按**字符数**计算，不是按字节\n   - 对于UTF-8编码，一个汉字占1个字符位置（在JavaScript和MySQL的VARCHAR中）\n   - 但实际数据库存储时，汉字可能占用更多字节\n3. **TEXT类型字段**：\n\n   - `precondition`、`purpose`、`steps`、`expected`、`remark`、`key_config` 等字段使用TEXT类型\n   - TEXT类型最大可存储65535字节，但Excel导入时有明确的字符限制（2000-5000字符）\n\n---\n\n### 六、总结\n\n代码库中共发现：\n\n- **前端 maxlength 限制**：12处\n- **前端 JavaScript 验证**：4处\n- **后端验证配置**：11个字段\n- **数据库 VARCHAR 字段**：约100+个字段\n\n主要限制值汇总：\n\n- 用户名/ID类：50字符\n- 名称类：32-100字符\n- 描述/备注类：128-2000字符\n- 长文本类：使用TEXT/LONGTEXT类型\n\n## 系统字符长度限制汇总\n\n以下是系统中所有关于汉字或字符长度限制的地方：\n\n---\n\n### 一、前端 HTML maxlength 属性限制\n\n\n| 文件位置                                                                                                       | 字段             | 限制值  |\n| -------------------------------------------------------------------------------------------------------------- | ---------------- | ------- |\n| [index.html:3027](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L3027)                               | 测试计划名称     | 64字符  |\n| [index.html:3400](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L3400)                               | 模块名称         | 32字符  |\n| [index.html:3414](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L3414)                               | 克隆模块名称     | 32字符  |\n| [index.html:3509](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L3509)                               | 编辑模块名称     | 32字符  |\n| [index.html:3536](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L3536)                               | 子模块名称       | 32字符  |\n| [index.html:3933](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L3933)                               | 一级测试点名称   | 64字符  |\n| [index.html:4021](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L4021)                               | 用例库名称       | 64字符  |\n| [index.html:4040](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L4040)                               | 克隆用例库名称   | 64字符  |\n| [index.html:198](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L198)                                 | 注册密码         | 最少6位 |\n| [script.js:9942](file:///Users/zhao/Desktop/my_projects/xtest/script.js#L9942)                                 | 备注输入框       | 256字符 |\n| [batch-create-cases.js:437](file:///Users/zhao/Desktop/my_projects/xtest/public/js/batch-create-cases.js#L437) | 批量创建用例名称 | 100字符 |\n| [batch-create-cases.js:456](file:///Users/zhao/Desktop/my_projects/xtest/public/js/batch-create-cases.js#L456) | 批量创建负责人   | 50字符  |\n\n---\n\n### 二、前端 JavaScript 验证\n\n\n| 文件位置                                                                                      | 验证内容       | 限制值  |\n| --------------------------------------------------------------------------------------------- | -------------- | ------- |\n| [script.js:4695-4696](file:///Users/zhao/Desktop/my_projects/xtest/script.js#L4695-L4696)     | 模块名称       | 32字符  |\n| [script.js:12379-12380](file:///Users/zhao/Desktop/my_projects/xtest/script.js#L12379-L12380) | 新密码         | 最少6位 |\n| [script.js:15828](file:///Users/zhao/Desktop/my_projects/xtest/script.js#L15828)              | 用例库名称默认 | 64字符  |\n\n---\n\n### 三、后端 Excel 导入字段验证\n\n在 [routes/excel.js:818-830](file:///Users/zhao/Desktop/my_projects/xtest/routes/excel.js#L818-L830)：\n\n\n| 字段         | 限制值   | 说明     |\n| ------------ | -------- | -------- |\n| name         | 500字符  | 用例名称 |\n| priority     | 50字符   | 优先级   |\n| type         | 100字符  | 用例类型 |\n| precondition | 2000字符 | 前置条件 |\n| purpose      | 2000字符 | 测试目的 |\n| steps        | 5000字符 | 测试步骤 |\n| expected     | 2000字符 | 预期结果 |\n| owner        | 100字符  | 执行人   |\n| status       | 50字符   | 维护状态 |\n| key_config   | 2000字符 | 关键配置 |\n| remark       | 2000字符 | 备注     |\n\n---\n\n### 四、数据库字段限制（主要字段）\n\n\n| 表名             | 字段     | 限制值  |\n| ---------------- | -------- | ------- |\n| users            | username | 50字符  |\n| users            | password | 255字符 |\n| users            | email    | 100字符 |\n| modules          | name     | 100字符 |\n| test_plans       | name     | 100字符 |\n| test_cases       | name     | 100字符 |\n| test_cases       | priority | 20字符  |\n| test_cases       | owner    | 50字符  |\n| case_libraries   | name     | 100字符 |\n| projects         | name     | 100字符 |\n| test_reports     | name     | 100字符 |\n| ai_models        | endpoint | 500字符 |\n| report_templates | name     | 200字符 |\n\n---\n\n### 五、存在的不一致问题\n\n\n| 字段       | 前端限制 | 后端Excel限制 | 数据库限制 |\n| ---------- | -------- | ------------- | ---------- |\n| 模块名称   | 32字符   | -             | 100字符    |\n| 用例库名称 | 64字符   | -             | 100字符    |\n| 用例名称   | 100字符  | 500字符       | 100字符    |\n\n**注意**：所有长度限制都是按**字符数**计算（一个汉字算1个字符），不是按字节数。\n\n```\n\n```\n',NULL,28,0,0,0,0,0,'normal','2026-04-03 02:29:41','2026-04-03 04:20:13');
/*!40000 ALTER TABLE `forum_posts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `forum_tags`
--

DROP TABLE IF EXISTS `forum_tags`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `forum_tags` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '标签ID',
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标签名称',
  `color` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '#3498db' COMMENT '标签颜色',
  `post_count` int DEFAULT '0' COMMENT '关联帖子数量',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `forum_tags`
--

LOCK TABLES `forum_tags` WRITE;
/*!40000 ALTER TABLE `forum_tags` DISABLE KEYS */;
INSERT INTO `forum_tags` VALUES (1,'经验分享','#27ae60',0,'2026-03-23 15:17:21'),(2,'问题求助','#e74c3c',0,'2026-03-23 15:17:21'),(3,'测试工具','#3498db',0,'2026-03-23 15:17:21'),(4,'自动化测试','#9b59b6',0,'2026-03-23 15:17:21'),(5,'性能测试','#f39c12',0,'2026-03-23 15:17:21'),(6,'接口测试','#1abc9c',0,'2026-03-23 15:17:21'),(7,'其他','#95a5a6',0,'2026-03-23 15:17:21');
/*!40000 ALTER TABLE `forum_tags` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `history`
--

DROP TABLE IF EXISTS `history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `version` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `history`
--

LOCK TABLES `history` WRITE;
/*!40000 ALTER TABLE `history` DISABLE KEYS */;
/*!40000 ALTER TABLE `history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `history_snapshots`
--

DROP TABLE IF EXISTS `history_snapshots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `history_snapshots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entity_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` int NOT NULL,
  `snapshot_data` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `version` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `history_snapshots`
--

LOCK TABLES `history_snapshots` WRITE;
/*!40000 ALTER TABLE `history_snapshots` DISABLE KEYS */;
/*!40000 ALTER TABLE `history_snapshots` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `hyperlink_configs`
--

DROP TABLE IF EXISTS `hyperlink_configs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hyperlink_configs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '配置名称',
  `prefix` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '链接前缀',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '描述',
  `sort_order` int DEFAULT '0' COMMENT '排序顺序',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `hyperlink_configs`
--

LOCK TABLES `hyperlink_configs` WRITE;
/*!40000 ALTER TABLE `hyperlink_configs` DISABLE KEYS */;
INSERT INTO `hyperlink_configs` VALUES (1,'芯片Bug','http://bugzilla.centecnetworks.com/show_bug.cgi?id=','',1,1,'2026-03-24 05:20:09','2026-03-24 05:20:09'),(2,'SdkBug','http://10.10.25.24/sdk_bug/show_bug.cgi?id=','',2,1,'2026-03-24 05:20:41','2026-03-24 05:20:41');
/*!40000 ALTER TABLE `hyperlink_configs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `level1_points`
--

DROP TABLE IF EXISTS `level1_points`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `level1_points` (
  `id` int NOT NULL AUTO_INCREMENT,
  `module_id` int NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `test_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT '功能测试',
  `order_index` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=53 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `level1_points`
--

LOCK TABLES `level1_points` WRITE;
/*!40000 ALTER TABLE `level1_points` DISABLE KEYS */;
INSERT INTO `level1_points` VALUES (1,4,'NetRx Buffer测试','功能测试',0,'2026-03-24 05:14:23','2026-03-24 05:14:23'),(2,5,'NetTx调度测试','功能测试',0,'2026-03-30 10:35:57','2026-03-30 10:35:57'),(3,4,'NetRx调度测试','功能测试',1,'2026-03-30 10:55:57','2026-03-30 10:55:57'),(46,4,'FastCbfc','功能测试',3,'2026-03-31 12:50:12','2026-03-31 12:50:12'),(52,4,'Log(两个通道, 可配长短)','功能测试',6,'2026-03-31 12:51:38','2026-03-31 12:51:38');
/*!40000 ALTER TABLE `level1_points` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `level2_points`
--

DROP TABLE IF EXISTS `level2_points`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `level2_points` (
  `id` int NOT NULL AUTO_INCREMENT,
  `level1_id` int NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `test_steps` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `expected_behavior` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `test_environment` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `case_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `level2_points`
--

LOCK TABLES `level2_points` WRITE;
/*!40000 ALTER TABLE `level2_points` DISABLE KEYS */;
/*!40000 ALTER TABLE `level2_points` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `modules`
--

DROP TABLE IF EXISTS `modules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `modules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `module_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `library_id` int DEFAULT NULL,
  `parent_id` int DEFAULT NULL,
  `order_index` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `module_id` (`module_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `modules`
--

LOCK TABLES `modules` WRITE;
/*!40000 ALTER TABLE `modules` DISABLE KEYS */;
INSERT INTO `modules` VALUES (1,'module1','模块1',NULL,NULL,0,'2026-03-23 14:43:59','2026-03-23 14:43:59'),(2,'module2','模块2',NULL,NULL,0,'2026-03-23 14:43:59','2026-03-23 14:43:59'),(3,'module3','模块3',NULL,NULL,0,'2026-03-23 14:43:59','2026-03-23 14:43:59'),(4,'MODULE_1774329236776_943','NetRx',1,NULL,0,'2026-03-24 05:13:56','2026-03-24 05:13:56'),(5,'MODULE_1774866942661_652','NetTx',2,NULL,0,'2026-03-30 10:35:42','2026-03-30 10:35:42');
/*!40000 ALTER TABLE `modules` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL COMMENT '接收通知的用户ID',
  `sender_id` int DEFAULT NULL COMMENT '触发通知的用户ID(可选)',
  `type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '通知类型: mention, comment, like, system',
  `target_id` int NOT NULL COMMENT '关联的目标ID (通常为帖子 post_id 或者评论 comment_id)',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT '系统通知' COMMENT '通知标题',
  `content` text COLLATE utf8mb4_unicode_ci COMMENT '通知完整内容',
  `content_preview` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '通知内容预览摘要',
  `data` json DEFAULT NULL COMMENT '额外数据(JSON格式)',
  `is_read` tinyint(1) DEFAULT '0' COMMENT '是否已读',
  `read_at` timestamp NULL DEFAULT NULL COMMENT '已读时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notifications_user_id` (`user_id`),
  KEY `idx_notifications_is_read` (`is_read`),
  KEY `idx_notifications_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notifications`
--

LOCK TABLES `notifications` WRITE;
/*!40000 ALTER TABLE `notifications` DISABLE KEYS */;
/*!40000 ALTER TABLE `notifications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `projects`
--

DROP TABLE IF EXISTS `projects`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `projects` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `projects`
--

LOCK TABLES `projects` WRITE;
/*!40000 ALTER TABLE `projects` DISABLE KEYS */;
INSERT INTO `projects` VALUES (1,'U12项目','U12','','2026-03-24 05:19:08','2026-03-24 05:19:08'),(2,'BXL项目','BXL','','2026-03-24 05:19:17','2026-03-24 05:19:17');
/*!40000 ALTER TABLE `projects` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `report_templates`
--

DROP TABLE IF EXISTS `report_templates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `report_templates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模板名称',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '模板描述',
  `file_path` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文件存储路径',
  `file_type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'md' COMMENT '文件类型：md/txt',
  `is_default` tinyint(1) DEFAULT '0' COMMENT '是否默认模板',
  `created_by` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '创建者',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_by` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最后编辑者',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后编辑时间',
  PRIMARY KEY (`id`),
  KEY `idx_name` (`name`),
  KEY `idx_default` (`is_default`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `report_templates`
--

LOCK TABLES `report_templates` WRITE;
/*!40000 ALTER TABLE `report_templates` DISABLE KEYS */;
INSERT INTO `report_templates` VALUES (1,'默认测试报告模板','xTest 默认测试报告模板，包含测试概览、风险分析和改进建议','/Users/zhao/Desktop/my_projects/xtest/templates/project_report.md','md',1,'system','2026-03-23 14:43:59',NULL,'2026-03-23 14:43:59');
/*!40000 ALTER TABLE `report_templates` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `review_records`
--

DROP TABLE IF EXISTS `review_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `review_records` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `case_id` int NOT NULL COMMENT '测试用例ID',
  `reviewer_id` int NOT NULL COMMENT '评审人ID',
  `submitter_id` int NOT NULL COMMENT '提交人ID',
  `action` enum('submit','approve','reject','resubmit') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作类型: submit-提交评审, approve-通过, reject-驳回, resubmit-重新提审',
  `comment` text COLLATE utf8mb4_unicode_ci COMMENT '评审意见',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_case_id` (`case_id`),
  KEY `idx_reviewer_id` (`reviewer_id`),
  KEY `idx_submitter_id` (`submitter_id`),
  KEY `idx_action` (`action`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `review_records_ibfk_1` FOREIGN KEY (`case_id`) REFERENCES `test_cases` (`id`) ON DELETE CASCADE,
  CONSTRAINT `review_records_ibfk_2` FOREIGN KEY (`reviewer_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `review_records_ibfk_3` FOREIGN KEY (`submitter_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=36 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='测试用例评审记录表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `review_records`
--

LOCK TABLES `review_records` WRITE;
/*!40000 ALTER TABLE `review_records` DISABLE KEYS */;
INSERT INTO `review_records` VALUES (2,43,3,3,'submit','','2026-04-01 10:33:09'),(3,43,3,4,'approve','步骤清晰','2026-04-01 12:08:46'),(5,38,3,3,'submit','','2026-04-01 15:05:53'),(6,38,3,3,'approve','可直接执行','2026-04-01 15:13:56'),(7,24,3,3,'submit','','2026-04-02 05:20:08'),(8,25,3,3,'submit','','2026-04-02 05:20:08'),(9,26,3,3,'submit','','2026-04-02 05:20:08'),(10,27,3,3,'submit','','2026-04-02 05:20:08'),(11,28,3,3,'submit','','2026-04-02 05:20:08'),(12,29,3,3,'submit','','2026-04-02 05:20:08'),(13,30,3,3,'submit','','2026-04-02 05:20:08'),(14,31,3,3,'submit','','2026-04-02 05:20:08'),(15,32,3,3,'submit','','2026-04-02 05:20:08'),(16,33,3,3,'submit','','2026-04-02 05:20:08'),(17,34,3,3,'submit','','2026-04-02 05:20:08'),(18,35,3,3,'submit','','2026-04-02 05:20:08'),(19,36,3,3,'submit','','2026-04-02 05:20:08'),(20,37,3,3,'submit','','2026-04-02 05:20:08'),(21,99,3,3,'submit','','2026-04-02 05:20:08'),(22,28,3,3,'approve','可直接执行','2026-04-02 06:25:16'),(23,24,3,3,'approve','','2026-04-02 06:25:21'),(24,25,3,3,'approve','','2026-04-02 07:54:02'),(25,26,3,3,'approve','可直接执行','2026-04-02 07:54:55'),(26,44,4,4,'submit','','2026-04-02 13:48:34'),(27,44,3,4,'submit','','2026-04-02 13:48:34'),(28,45,4,4,'submit','','2026-04-02 13:48:34'),(29,45,3,4,'submit','','2026-04-02 13:48:34'),(30,46,4,4,'submit','','2026-04-02 13:48:34'),(31,46,3,4,'submit','','2026-04-02 13:48:34'),(32,44,4,4,'approve','可直接执行','2026-04-02 13:56:57'),(33,45,4,4,'approve','可直接执行','2026-04-02 13:59:27'),(34,43,4,4,'approve','可直接执行','2026-04-02 15:00:46'),(35,46,4,4,'approve','可直接执行','2026-04-03 02:33:14');
/*!40000 ALTER TABLE `review_records` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_case_environments`
--

DROP TABLE IF EXISTS `test_case_environments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_case_environments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `test_case_id` int NOT NULL,
  `environment_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_test_case_environment` (`test_case_id`,`environment_id`),
  KEY `environment_id` (`environment_id`),
  CONSTRAINT `test_case_environments_ibfk_1` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE CASCADE,
  CONSTRAINT `test_case_environments_ibfk_2` FOREIGN KEY (`environment_id`) REFERENCES `environments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4634 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_case_environments`
--

LOCK TABLES `test_case_environments` WRITE;
/*!40000 ALTER TABLE `test_case_environments` DISABLE KEYS */;
INSERT INTO `test_case_environments` VALUES (58,39,47,'2026-03-30 10:36:50'),(59,39,48,'2026-03-30 10:36:50'),(60,39,50,'2026-03-30 10:36:50'),(335,61,47,'2026-04-03 06:50:04'),(337,60,47,'2026-04-03 06:50:04'),(4474,113,48,'2026-04-07 04:39:01'),(4475,113,50,'2026-04-07 04:39:01'),(4478,99,48,'2026-04-07 04:39:01'),(4479,99,50,'2026-04-07 04:39:01'),(4482,42,47,'2026-04-07 04:39:01'),(4483,42,48,'2026-04-07 04:39:01'),(4484,42,50,'2026-04-07 04:39:01'),(4488,41,47,'2026-04-07 04:39:01'),(4489,41,48,'2026-04-07 04:39:01'),(4490,41,50,'2026-04-07 04:39:01'),(4494,40,47,'2026-04-07 04:39:01'),(4495,40,48,'2026-04-07 04:39:01'),(4496,40,49,'2026-04-07 04:39:01'),(4500,38,47,'2026-04-07 04:39:01'),(4501,38,48,'2026-04-07 04:39:01'),(4502,38,50,'2026-04-07 04:39:01'),(4506,37,47,'2026-04-07 04:39:01'),(4507,37,48,'2026-04-07 04:39:01'),(4508,37,50,'2026-04-07 04:39:01'),(4512,36,47,'2026-04-07 04:39:01'),(4513,36,48,'2026-04-07 04:39:01'),(4514,36,50,'2026-04-07 04:39:01'),(4518,35,47,'2026-04-07 04:39:01'),(4519,35,48,'2026-04-07 04:39:01'),(4520,35,50,'2026-04-07 04:39:01'),(4524,34,47,'2026-04-07 04:39:01'),(4525,34,48,'2026-04-07 04:39:01'),(4526,34,50,'2026-04-07 04:39:01'),(4530,33,46,'2026-04-07 04:39:01'),(4531,33,48,'2026-04-07 04:39:01'),(4532,33,49,'2026-04-07 04:39:01'),(4536,32,47,'2026-04-07 04:39:01'),(4537,32,48,'2026-04-07 04:39:01'),(4538,32,49,'2026-04-07 04:39:01'),(4542,31,48,'2026-04-07 04:39:01'),(4544,30,49,'2026-04-07 04:39:01'),(4546,29,46,'2026-04-07 04:39:01'),(4548,28,49,'2026-04-07 04:39:01'),(4550,27,48,'2026-04-07 04:39:01'),(4552,26,48,'2026-04-07 04:39:01'),(4554,25,48,'2026-04-07 04:39:01'),(4556,24,49,'2026-04-07 04:39:01'),(4558,46,49,'2026-04-07 04:39:01'),(4560,45,47,'2026-04-07 04:39:01'),(4561,45,48,'2026-04-07 04:39:01'),(4562,45,50,'2026-04-07 04:39:01'),(4566,44,47,'2026-04-07 04:39:01'),(4567,44,48,'2026-04-07 04:39:01'),(4568,44,50,'2026-04-07 04:39:01'),(4572,43,47,'2026-04-07 04:39:01'),(4573,43,48,'2026-04-07 04:39:01'),(4574,43,50,'2026-04-07 04:39:01');
/*!40000 ALTER TABLE `test_case_environments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_case_methods`
--

DROP TABLE IF EXISTS `test_case_methods`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_case_methods` (
  `id` int NOT NULL AUTO_INCREMENT,
  `test_case_id` int NOT NULL,
  `method_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_test_case_method` (`test_case_id`,`method_id`),
  KEY `method_id` (`method_id`),
  CONSTRAINT `test_case_methods_ibfk_1` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE CASCADE,
  CONSTRAINT `test_case_methods_ibfk_2` FOREIGN KEY (`method_id`) REFERENCES `test_methods` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=841 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_case_methods`
--

LOCK TABLES `test_case_methods` WRITE;
/*!40000 ALTER TABLE `test_case_methods` DISABLE KEYS */;
INSERT INTO `test_case_methods` VALUES (15,39,1,'2026-03-30 10:36:50'),(812,113,31,'2026-04-07 04:39:01'),(813,99,31,'2026-04-07 04:39:01'),(814,41,1,'2026-04-07 04:39:01'),(815,40,1,'2026-04-07 04:39:01'),(816,38,1,'2026-04-07 04:39:01'),(817,35,1,'2026-04-07 04:39:01'),(818,35,2,'2026-04-07 04:39:01'),(819,35,31,'2026-04-07 04:39:01'),(820,34,1,'2026-04-07 04:39:01'),(821,34,2,'2026-04-07 04:39:01'),(822,34,31,'2026-04-07 04:39:01'),(823,33,1,'2026-04-07 04:39:01'),(824,33,31,'2026-04-07 04:39:01'),(825,32,1,'2026-04-07 04:39:01'),(826,32,31,'2026-04-07 04:39:01'),(827,46,31,'2026-04-07 04:39:01'),(828,45,31,'2026-04-07 04:39:01'),(829,44,1,'2026-04-07 04:39:01'),(830,43,1,'2026-04-07 04:39:01');
/*!40000 ALTER TABLE `test_case_methods` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_case_phases`
--

DROP TABLE IF EXISTS `test_case_phases`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_case_phases` (
  `id` int NOT NULL AUTO_INCREMENT,
  `test_case_id` int NOT NULL,
  `phase_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_test_case_phase` (`test_case_id`,`phase_id`),
  KEY `phase_id` (`phase_id`),
  CONSTRAINT `test_case_phases_ibfk_1` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE CASCADE,
  CONSTRAINT `test_case_phases_ibfk_2` FOREIGN KEY (`phase_id`) REFERENCES `test_phases` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=974 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_case_phases`
--

LOCK TABLES `test_case_phases` WRITE;
/*!40000 ALTER TABLE `test_case_phases` DISABLE KEYS */;
INSERT INTO `test_case_phases` VALUES (36,39,3,'2026-03-30 10:36:50'),(939,113,3,'2026-04-07 04:39:01'),(940,99,3,'2026-04-07 04:39:01'),(941,41,3,'2026-04-07 04:39:01'),(942,40,2,'2026-04-07 04:39:01'),(943,38,3,'2026-04-07 04:39:01'),(944,35,3,'2026-04-07 04:39:01'),(945,34,3,'2026-04-07 04:39:01'),(946,33,3,'2026-04-07 04:39:01'),(947,32,2,'2026-04-07 04:39:01'),(948,31,3,'2026-04-07 04:39:01'),(949,30,2,'2026-04-07 04:39:01'),(950,29,3,'2026-04-07 04:39:01'),(951,28,2,'2026-04-07 04:39:01'),(952,27,1,'2026-04-07 04:39:01'),(953,26,1,'2026-04-07 04:39:01'),(954,25,1,'2026-04-07 04:39:01'),(955,24,2,'2026-04-07 04:39:01'),(956,46,2,'2026-04-07 04:39:01'),(957,45,3,'2026-04-07 04:39:01'),(958,44,3,'2026-04-07 04:39:01'),(959,43,3,'2026-04-07 04:39:01');
/*!40000 ALTER TABLE `test_case_phases` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_case_progresses`
--

DROP TABLE IF EXISTS `test_case_progresses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_case_progresses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `test_case_id` int NOT NULL,
  `progress_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_test_case_progress` (`test_case_id`,`progress_id`),
  KEY `progress_id` (`progress_id`),
  CONSTRAINT `test_case_progresses_ibfk_1` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE CASCADE,
  CONSTRAINT `test_case_progresses_ibfk_2` FOREIGN KEY (`progress_id`) REFERENCES `test_progresses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_case_progresses`
--

LOCK TABLES `test_case_progresses` WRITE;
/*!40000 ALTER TABLE `test_case_progresses` DISABLE KEYS */;
/*!40000 ALTER TABLE `test_case_progresses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_case_projects`
--

DROP TABLE IF EXISTS `test_case_projects`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_case_projects` (
  `id` int NOT NULL AUTO_INCREMENT,
  `test_case_id` int NOT NULL,
  `project_id` int NOT NULL,
  `owner` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `progress_id` int DEFAULT NULL,
  `status_id` int DEFAULT NULL,
  `remark` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_test_case_project` (`test_case_id`,`project_id`),
  KEY `project_id` (`project_id`),
  KEY `progress_id` (`progress_id`),
  KEY `status_id` (`status_id`),
  CONSTRAINT `test_case_projects_ibfk_1` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE CASCADE,
  CONSTRAINT `test_case_projects_ibfk_2` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `test_case_projects_ibfk_3` FOREIGN KEY (`progress_id`) REFERENCES `test_progresses` (`id`) ON DELETE SET NULL,
  CONSTRAINT `test_case_projects_ibfk_4` FOREIGN KEY (`status_id`) REFERENCES `test_statuses` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=1216 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_case_projects`
--

LOCK TABLES `test_case_projects` WRITE;
/*!40000 ALTER TABLE `test_case_projects` DISABLE KEYS */;
INSERT INTO `test_case_projects` VALUES (15,39,1,'zhaosz',2,1,'123','2026-03-30 10:36:50','2026-03-30 10:36:50'),(16,39,2,'zhaosz',2,NULL,'456','2026-03-30 10:36:50','2026-03-30 10:36:50'),(1174,113,1,'xxxx',1,1,'','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1175,99,1,'xxxx',1,1,'','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1176,42,1,'cccc',2,1,'123','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1177,42,2,'cccc',2,NULL,'456','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1178,41,1,'cccc',2,1,'123','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1179,41,2,'cccc',2,NULL,'456','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1180,40,1,'cccc',1,NULL,'456','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1181,40,2,'cccc',2,1,'123','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1182,38,1,'zhaosz',2,1,'123','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1183,38,2,'zhaosz',2,NULL,'456','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1184,37,1,'zhaosz',2,1,'123','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1185,37,2,'zhaosz',2,NULL,'456','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1186,36,1,'zhaosz',NULL,NULL,'','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1187,36,2,'zhaosz',NULL,NULL,'','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1188,35,1,'zhaosz',2,1,'123','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1189,35,2,'zhaosz',2,NULL,'456','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1190,34,1,'zhaosz',2,1,'123','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1191,34,2,'zhaosz',2,NULL,'456','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1192,33,1,'zhaosz',1,NULL,'456','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1193,33,2,'zhaosz',2,1,'123','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1194,32,1,'zhaosz',1,NULL,'456','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1195,32,2,'zhaosz',2,1,'123','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1196,46,1,'cccc',2,1,'','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1197,45,1,'cccc',2,1,'123','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1198,45,2,'cccc',2,NULL,'456','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1199,44,1,'cccc',2,1,'123','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1200,44,2,'cccc',2,NULL,'456','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1201,43,1,'cccc',2,1,'123','2026-04-07 04:39:01','2026-04-07 04:39:01'),(1202,43,2,'cccc',2,NULL,'456','2026-04-07 04:39:01','2026-04-07 04:39:01');
/*!40000 ALTER TABLE `test_case_projects` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_case_scripts`
--

DROP TABLE IF EXISTS `test_case_scripts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_case_scripts` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `test_case_id` int NOT NULL COMMENT '测试用例ID',
  `script_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '脚本名称，如 sdk_fdb_func_xxx_xxx.tcl',
  `script_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'tcl' COMMENT '脚本类型：tcl/py/sh/other',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '脚本描述',
  `file_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '上传文件的存储路径',
  `file_size` bigint DEFAULT NULL COMMENT '文件大小（字节）',
  `file_hash` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '文件MD5哈希值，用于去重',
  `original_filename` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '原始文件名',
  `link_url` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '外部链接URL',
  `link_title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '链接显示标题',
  `link_type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'external' COMMENT '链接类型：external/gitlab/jira/other',
  `order_index` int DEFAULT '0' COMMENT '排序序号',
  `creator` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '创建人',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_test_case_id` (`test_case_id`),
  KEY `idx_script_type` (`script_type`),
  KEY `idx_script_name` (`script_name`),
  CONSTRAINT `test_case_scripts_ibfk_1` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='测试用例关联脚本表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_case_scripts`
--

LOCK TABLES `test_case_scripts` WRITE;
/*!40000 ALTER TABLE `test_case_scripts` DISABLE KEYS */;
INSERT INTO `test_case_scripts` VALUES (1,45,'database_schema.txt','other','','/Users/zhao/Desktop/my_projects/xtest/uploads/scripts/2026/04/1775195203465-615118400.txt',55617,NULL,'database_schema.txt',NULL,NULL,'external',0,'cccc','2026-04-03 05:47:25','2026-04-03 05:47:25');
/*!40000 ALTER TABLE `test_case_scripts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_case_sources`
--

DROP TABLE IF EXISTS `test_case_sources`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_case_sources` (
  `id` int NOT NULL AUTO_INCREMENT,
  `test_case_id` int NOT NULL,
  `source_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_test_case_source` (`test_case_id`,`source_id`),
  KEY `source_id` (`source_id`),
  CONSTRAINT `test_case_sources_ibfk_1` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE CASCADE,
  CONSTRAINT `test_case_sources_ibfk_2` FOREIGN KEY (`source_id`) REFERENCES `test_sources` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1765 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_case_sources`
--

LOCK TABLES `test_case_sources` WRITE;
/*!40000 ALTER TABLE `test_case_sources` DISABLE KEYS */;
INSERT INTO `test_case_sources` VALUES (23,39,1,'2026-03-30 10:36:50'),(24,39,2,'2026-03-30 10:36:50'),(25,39,4,'2026-03-30 10:36:50'),(1708,113,1,'2026-04-07 04:39:01'),(1709,99,1,'2026-04-07 04:39:01'),(1710,42,1,'2026-04-07 04:39:01'),(1711,42,2,'2026-04-07 04:39:01'),(1712,42,4,'2026-04-07 04:39:01'),(1713,41,1,'2026-04-07 04:39:01'),(1714,41,2,'2026-04-07 04:39:01'),(1715,41,4,'2026-04-07 04:39:01'),(1716,40,1,'2026-04-07 04:39:01'),(1717,40,3,'2026-04-07 04:39:01'),(1718,38,1,'2026-04-07 04:39:01'),(1719,38,2,'2026-04-07 04:39:01'),(1720,38,4,'2026-04-07 04:39:01'),(1721,37,1,'2026-04-07 04:39:01'),(1722,37,2,'2026-04-07 04:39:01'),(1723,37,4,'2026-04-07 04:39:01'),(1724,36,1,'2026-04-07 04:39:01'),(1725,36,2,'2026-04-07 04:39:01'),(1726,36,4,'2026-04-07 04:39:01'),(1727,35,1,'2026-04-07 04:39:01'),(1728,35,2,'2026-04-07 04:39:01'),(1729,35,4,'2026-04-07 04:39:01'),(1730,34,1,'2026-04-07 04:39:01'),(1731,34,2,'2026-04-07 04:39:01'),(1732,34,4,'2026-04-07 04:39:01'),(1733,33,1,'2026-04-07 04:39:01'),(1734,33,3,'2026-04-07 04:39:01'),(1735,32,1,'2026-04-07 04:39:01'),(1736,32,3,'2026-04-07 04:39:01'),(1737,46,2,'2026-04-07 04:39:01'),(1738,46,3,'2026-04-07 04:39:01'),(1739,45,1,'2026-04-07 04:39:01'),(1740,45,2,'2026-04-07 04:39:01'),(1741,45,3,'2026-04-07 04:39:01'),(1742,45,4,'2026-04-07 04:39:01'),(1743,44,1,'2026-04-07 04:39:01'),(1744,44,2,'2026-04-07 04:39:01'),(1745,44,4,'2026-04-07 04:39:01'),(1746,43,1,'2026-04-07 04:39:01'),(1747,43,2,'2026-04-07 04:39:01'),(1748,43,4,'2026-04-07 04:39:01');
/*!40000 ALTER TABLE `test_case_sources` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_case_statuses`
--

DROP TABLE IF EXISTS `test_case_statuses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_case_statuses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `test_case_id` int NOT NULL,
  `status_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_test_case_status` (`test_case_id`,`status_id`),
  KEY `status_id` (`status_id`),
  CONSTRAINT `test_case_statuses_ibfk_1` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE CASCADE,
  CONSTRAINT `test_case_statuses_ibfk_2` FOREIGN KEY (`status_id`) REFERENCES `test_statuses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_case_statuses`
--

LOCK TABLES `test_case_statuses` WRITE;
/*!40000 ALTER TABLE `test_case_statuses` DISABLE KEYS */;
/*!40000 ALTER TABLE `test_case_statuses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_case_test_types`
--

DROP TABLE IF EXISTS `test_case_test_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_case_test_types` (
  `id` int NOT NULL AUTO_INCREMENT,
  `test_case_id` int NOT NULL,
  `test_type_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_test_case_test_type` (`test_case_id`,`test_type_id`),
  KEY `test_type_id` (`test_type_id`),
  CONSTRAINT `test_case_test_types_ibfk_1` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE CASCADE,
  CONSTRAINT `test_case_test_types_ibfk_2` FOREIGN KEY (`test_type_id`) REFERENCES `test_types` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1272 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_case_test_types`
--

LOCK TABLES `test_case_test_types` WRITE;
/*!40000 ALTER TABLE `test_case_test_types` DISABLE KEYS */;
INSERT INTO `test_case_test_types` VALUES (16,39,1,'2026-03-30 10:36:50'),(93,61,1,'2026-04-03 06:50:04'),(94,60,1,'2026-04-03 06:50:04'),(1229,113,3,'2026-04-07 04:39:01'),(1230,99,3,'2026-04-07 04:39:01'),(1231,42,2,'2026-04-07 04:39:01'),(1232,41,1,'2026-04-07 04:39:01'),(1233,40,1,'2026-04-07 04:39:01'),(1234,38,1,'2026-04-07 04:39:01'),(1235,37,1,'2026-04-07 04:39:01'),(1236,36,1,'2026-04-07 04:39:01'),(1237,35,1,'2026-04-07 04:39:01'),(1238,34,1,'2026-04-07 04:39:01'),(1239,33,3,'2026-04-07 04:39:01'),(1240,32,1,'2026-04-07 04:39:01'),(1241,31,2,'2026-04-07 04:39:01'),(1242,30,5,'2026-04-07 04:39:01'),(1243,29,5,'2026-04-07 04:39:01'),(1244,28,3,'2026-04-07 04:39:01'),(1245,27,4,'2026-04-07 04:39:01'),(1246,26,4,'2026-04-07 04:39:01'),(1247,25,4,'2026-04-07 04:39:01'),(1248,24,5,'2026-04-07 04:39:01'),(1249,46,5,'2026-04-07 04:39:01'),(1250,45,1,'2026-04-07 04:39:01'),(1251,44,1,'2026-04-07 04:39:01'),(1252,43,1,'2026-04-07 04:39:01'),(1253,92,1,'2026-04-07 04:39:01'),(1254,98,1,'2026-04-07 04:39:01'),(1255,97,1,'2026-04-07 04:39:01'),(1256,96,1,'2026-04-07 04:39:01');
/*!40000 ALTER TABLE `test_case_test_types` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_cases`
--

DROP TABLE IF EXISTS `test_cases`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_cases` (
  `id` int NOT NULL AUTO_INCREMENT,
  `case_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `priority` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `precondition` text COLLATE utf8mb4_unicode_ci,
  `purpose` text COLLATE utf8mb4_unicode_ci,
  `steps` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `expected` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `creator` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `library_id` int DEFAULT NULL,
  `module_id` int NOT NULL,
  `level1_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `owner` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'admin',
  `remark` text COLLATE utf8mb4_unicode_ci,
  `key_config` text COLLATE utf8mb4_unicode_ci,
  `method` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT '自动化',
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT '维护中',
  `is_deleted` tinyint(1) DEFAULT '0' COMMENT '软删除标记',
  `review_status` enum('draft','pending','approved','rejected') COLLATE utf8mb4_unicode_ci DEFAULT 'draft' COMMENT '评审状态: draft-草稿, pending-待评审, approved-已通过, rejected-被驳回',
  `reviewer_id` int DEFAULT NULL COMMENT '评审人ID',
  `review_submitted_at` timestamp NULL DEFAULT NULL COMMENT '提交评审时间',
  `review_completed_at` timestamp NULL DEFAULT NULL COMMENT '评审完成时间',
  `deleted_at` timestamp NULL DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `case_id` (`case_id`),
  KEY `idx_test_cases_library_id` (`library_id`),
  KEY `idx_test_cases_module_id` (`module_id`),
  KEY `idx_test_cases_owner` (`owner`),
  KEY `idx_test_cases_status` (`status`),
  KEY `idx_review_status` (`review_status`),
  KEY `idx_reviewer_id` (`reviewer_id`),
  CONSTRAINT `fk_test_cases_reviewer` FOREIGN KEY (`reviewer_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=118 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_cases`
--

LOCK TABLES `test_cases` WRITE;
/*!40000 ALTER TABLE `test_cases` DISABLE KEYS */;
INSERT INTO `test_cases` VALUES (24,'CASE-20260330-88742','测试123','低','异常测试','测试123','','的权威千千万','额前发生的v说v','zhaosz',1,4,1,'2026-03-30 07:33:51','2026-04-07 04:39:01','zhaosz','3242342342无法','','manual','维护中',0,'approved',NULL,'2026-04-02 05:20:08','2026-04-02 06:25:21',NULL),(25,'CASE-20260330-692','测试123-Copy','低','规格测试','测试123','','的权威千千万','额前发生的v说v','zhaosz',1,4,1,'2026-03-30 07:33:51','2026-04-07 04:39:01','zhaosz','3242342342无法','','manual','维护中',0,'approved',NULL,'2026-04-02 05:20:08','2026-04-02 07:54:02',NULL),(26,'CASE-20260330-56150','测试123-Copy-Copy','低','规格测试','测试123','','的权威千千万','额前发生的v说v','zhaosz',1,4,1,'2026-03-30 07:33:51','2026-04-07 04:39:01','zhaosz','3242342342无法','','manual','维护中',0,'approved',NULL,'2026-04-02 05:20:08','2026-04-02 07:54:55',NULL),(27,'CASE-20260330-99697','测试123-Copy-Copy-Copy','低','规格测试','测试123','','的权威千千万','额前发生的v说v','zhaosz',1,4,1,'2026-03-30 07:33:51','2026-04-07 04:39:01','zhaosz','3242342342无法','','manual','维护中',0,'pending',NULL,'2026-04-02 05:20:08',NULL,NULL),(28,'CASE-20260330-84352','U123','低','压力测试','hhhhhhh','','xxxxxx','aaaa','zhaosz',1,4,1,'2026-03-30 07:40:12','2026-04-07 04:39:01','zhaosz','qwqwwq','','manual','维护中',0,'approved',NULL,'2026-04-02 05:20:08','2026-04-02 06:25:16',NULL),(29,'CASE-20260330-94674','U123-Copy','低','异常测试','hhhhhhh','','xxxxxx','aaaa','zhaosz',1,4,1,'2026-03-30 07:40:12','2026-04-07 04:39:01','zhaosz','qwqwwq','','manual','维护中',0,'pending',NULL,'2026-04-02 05:20:08',NULL,NULL),(30,'CASE-20260330-83556','测试1000000','低','异常测试','大胜大胜大胜显示','','萨大胜大胜大胜擦擦撒','我亲亲亲亲亲','zhaosz',1,4,1,'2026-03-30 07:48:07','2026-04-07 04:39:01','zhaosz','飒飒大方','','manual','维护中',0,'pending',NULL,'2026-04-02 05:20:08',NULL,NULL),(31,'CASE-20260330-88836','测试1000001','低','性能测试','大胜大胜大胜显示','','萨大胜大胜大胜擦擦撒','我亲亲亲亲亲','zhaosz',1,4,1,'2026-03-30 07:48:07','2026-04-07 04:39:01','zhaosz','飒飒大方','','manual','维护中',0,'pending',NULL,'2026-04-02 05:20:08',NULL,NULL),(32,'CASE-20260330-52ff3672-0','test netrx buffer manager','低','功能测试','rtl release','buffer perfect','1. ooo\n2. xxx\n3. cccc','1. xxx\nport xasa','zhaosz',1,4,1,'2026-03-30 08:04:11','2026-04-07 04:39:01','zhaosz','buisbdiuabdu','port xxxx ','manual','维护中',0,'pending',NULL,'2026-04-02 05:20:08',NULL,NULL),(33,'CASE-20260330-96cd11a0-1','test netrx buffer manager-Copy','低','压力测试','rtl release','buffer perfect','1. ooo\n2. xxx\n3. cccc','1. xxx\nport xasa','zhaosz',1,4,1,'2026-03-30 08:04:11','2026-04-07 04:39:01','zhaosz','buisbdiuabdu','port xxxx ','manual','维护中',0,'pending',NULL,'2026-04-02 05:20:08',NULL,NULL),(34,'CASE-20260330-cff3b43f-0','netrx wrr测试','低','功能测试','哈哈哈哈哈哈哈','啊撒啊撒撒啊撒','达大胜大胜大的','详细萨达大胜大胜v丰富的v','zhaosz',1,4,1,'2026-03-30 08:14:18','2026-04-07 04:39:01','zhaosz','扭扭捏捏那你呢','他天天吞吞吐吐','manual','维护中',0,'pending',NULL,'2026-04-02 05:20:08',NULL,NULL),(35,'CASE-20260330-8cff23cc-1','netrx wrr测试-Copy','低','功能测试','哈哈哈哈哈哈哈','啊撒啊撒撒啊撒','达大胜大胜大的','哈哈哈哈哈哈哈','zhaosz',1,4,1,'2026-03-30 08:14:18','2026-04-07 04:39:01','zhaosz','扭扭捏捏那你呢','他天天吞吞吐吐','manual','维护中',0,'pending',NULL,'2026-04-02 05:20:08',NULL,NULL),(36,'CASE-20260330-1d537825-0','netrx wrr测试-Clone','低','功能测试','哈哈哈哈哈哈哈','啊撒啊撒撒啊撒','达大胜大胜大的','哈哈哈哈哈哈哈','zhaosz',1,4,1,'2026-03-30 10:11:06','2026-04-07 04:39:01','zhaosz','扭扭捏捏那你呢','他天天吞吞吐吐','manual','维护中',0,'pending',NULL,'2026-04-02 05:20:08',NULL,NULL),(37,'CASE-20260330-9c824020-0','netrx wrr测试-Clone','低','功能测试','哈哈哈哈哈哈哈','啊撒啊撒撒啊撒','达大胜大胜大的','详细萨达大胜大胜v丰富的v','zhaosz',1,4,1,'2026-03-30 10:19:50','2026-04-07 04:39:01','zhaosz','扭扭捏捏那你呢','他天天吞吞吐吐','manual','维护中',0,'pending',NULL,'2026-04-02 05:20:08',NULL,NULL),(38,'CASE-20260330-4fcc3b13-0','netrx wrr测试-Clone','低','功能测试','哈哈哈哈哈哈哈','啊撒啊撒撒啊撒','达大胜大胜大的','详细萨达大胜大胜v丰富的v','zhaosz',1,4,1,'2026-03-30 10:28:47','2026-04-07 04:39:01','zhaosz','扭扭捏捏那你呢','他天天吞吞吐吐','manual','维护中',0,'approved',3,'2026-04-01 15:05:53','2026-04-01 15:13:56',NULL),(39,'CASE-20260330-547d488d-0','netrx wrr测试-Clone-Clone','高','功能测试','哈哈哈哈哈哈哈','啊撒啊撒撒啊撒','达大胜大胜大的','详细萨达大胜大胜v丰富的v','zhaosz',2,5,2,'2026-03-30 10:36:50','2026-03-30 10:36:50','zhaosz','扭扭捏捏那你呢','他天天吞吞吐吐','manual','维护中',0,'draft',NULL,NULL,NULL,NULL),(40,'CASE-20260330-7a853db9-0','test netrx buffer manager-Clone','低','功能测试','rtl release','buffer perfect','1. ooo\n2. xxx\n3. cccc','1. xxx\nport xasa','cccc',1,4,1,'2026-03-30 11:25:01','2026-04-07 04:39:01','cccc','buisbdiuabdu','port xxxx ','manual','维护中',0,'draft',NULL,NULL,NULL,NULL),(41,'CASE-20260330-d91ded4e-0','netrx wrr测试-Clone-Clone2','低','功能测试','哈哈哈哈哈哈哈','啊撒啊撒撒啊撒','达大胜大胜大的','详细萨达大胜大胜v丰富的v','cccc',1,4,1,'2026-03-30 11:33:19','2026-04-07 04:39:01','cccc','扭扭捏捏那你呢','他天天吞吞吐吐','manual','维护中',0,'draft',NULL,NULL,NULL,NULL),(42,'CASE-20260330-49c9cd03-0','netrx wrr测试-Clone-Clone','低','性能测试','哈哈哈哈哈哈哈','#### ✅ 优点\n1. **参数验证完善**\n   - 验证case_ids数组不为空\n   - 验证数量限制（最多50个）\n   - 验证评审人是否存在\n   - 验证评审说明长度（最多500字）\n\n2. **权限控制严格**\n   - 只有创建者才能提交评审\n   - 验证用例状态（只允许draft和rejected）\n\n3. **事务处理正确**\n   - 使用数据库事务确保原子性\n   - 正确处理commit和rollback\n   - 使用finally释放连接\n\n4. **数据一致性**\n   - 清除旧的评审人记录\n   - 插入新的评审人记录\n   - 记录评审历史\n\n5. **实时通知**\n   - WebSocket通知评审人\n\n#### ⚠️ 需要注意\n1. **SQL注入风险**：使用占位符，✅ 已正确处理\n2. **XSS风险**：comment字段需要转义，前端已处理\n3. **性能考虑**：批量操作使用循环，建议优化为批量INSERT','达大胜大胜大的','详细萨达大胜大胜v丰富的v','cccc',1,4,1,'2026-03-30 11:36:48','2026-04-07 04:39:01','cccc','扭扭捏捏那你呢','他天天吞吞吐吐','manual','维护中',0,'draft',NULL,NULL,NULL,NULL),(43,'CASE-20260330-c387741c-0','netrx wrr测试-Clone','低','功能测试','哈哈哈哈哈哈哈','啊撒啊撒撒啊撒','达大胜大胜大的','详细萨达大胜大胜v丰富的v','cccc',1,4,3,'2026-03-30 12:00:14','2026-04-07 04:39:01','cccc','扭扭捏捏那你呢','他天天吞吞吐吐','manual','维护中',0,'approved',3,'2026-04-01 10:33:09','2026-04-02 15:00:46',NULL),(44,'CASE-20260330-fb4c8ae5-0','netrx wrr测试-Clone','低','功能测试','哈哈哈哈哈哈哈','啊撒啊撒撒啊撒','达大胜大胜大的','详细萨达大胜大胜v丰富的v','cccc',1,4,3,'2026-03-30 12:01:24','2026-04-07 04:39:01','cccc','扭扭捏捏那你呢','他天天吞吞吐吐','manual','维护中',0,'pending',NULL,'2026-04-02 13:48:34',NULL,NULL),(45,'CASE-20260330-605b69c4-0','netrx wrr测试-Clone222','低','功能测试','哈哈哈哈哈哈哈','啊撒啊撒撒啊撒','达大胜大胜大的','详细萨达大胜大胜v丰富的v','cccc',1,4,3,'2026-03-30 12:09:59','2026-04-07 04:39:01','cccc','扭扭捏捏那你呢','他天天吞吞吐吐','manual','维护中',0,'pending',NULL,'2026-04-02 13:48:34',NULL,NULL),(46,'CASE-20260331-859578e5-0','123','低','异常测试','','','','','cccc',1,4,3,'2026-03-31 07:29:50','2026-04-07 04:39:01','cccc','','','manual','维护中',0,'pending',NULL,'2026-04-02 13:48:34',NULL,NULL),(60,'CASE-1774952514390-1702-4','在NetTx根据真实长度, 重新计算CU, 并定时发送Cc','低','功能测试','','','','','import',1,4,11,'2026-03-31 10:21:54','2026-04-03 06:50:04','cccc','','','自动化','维护中',0,'draft',NULL,NULL,NULL,NULL),(61,'CASE-1774952514391-2019-5','NetRx响应后直接对NetTx起stall','低','功能测试','','','抓波形看latency','','import',1,4,12,'2026-03-31 10:21:54','2026-04-03 06:50:04','cccc','','','自动化','维护中',0,'draft',NULL,NULL,NULL,NULL),(92,'CASE-1774961412856-751-3','200G以上','低','功能测试','','','','','import',1,4,46,'2026-03-31 12:50:12','2026-04-07 04:39:01','cccc','','','自动化','维护中',0,'draft',NULL,NULL,NULL,NULL),(96,'CASE-1774961498119-2831-6','整包log','低','功能测试','','','测试方法:\n①修改log buf水线, 能够存下整个长包\n②配置所有端口log\n长log通道占用期间, 其他port不能起klog请求\n期望结果\n③报文在NetTx能被完整log, 且所有端口的包都能到log','','import',1,4,52,'2026-03-31 12:51:38','2026-04-07 04:39:01','cccc','','','自动化','维护中',0,'draft',NULL,NULL,NULL,NULL),(97,'CASE-1774961498119-818-7','Sop Log(短log)','低','功能测试','','','测试方法:\n①修改log buf水线, 能存下整个长包\n②配置所有端口log, 有部分长log, 一部分短log\n期望结果\n①短log报文能正常log出来\n②报文在NetTx能被log时, 由于短log会沾满log buf, 导致长log Fop截断','','import',1,4,52,'2026-03-31 12:51:38','2026-04-07 04:39:01','cccc','','','自动化','维护中',0,'draft',NULL,NULL,NULL,NULL),(98,'CASE-1774961498119-5025-8','Log叠加截断','低','功能测试','','','测试方法:\n①配置报文发生Udp编辑和log\n期望结果\n②观察原始报文被编辑, log报文不继续被编辑\nlog靠前, log报文不应该发生截断和编辑','','import',1,4,52,'2026-03-31 12:51:38','2026-04-07 04:39:01','cccc','','','自动化','维护中',0,'draft',NULL,NULL,NULL,NULL),(99,'CASE-20260401-8024','大胜达','低','压力测试','','','qqeqwqe','','zhaosz',1,4,1,'2026-04-01 15:05:08','2026-04-07 04:39:01','zhaosz','','','自动化','维护中',0,'pending',NULL,'2026-04-02 05:20:08',NULL,NULL),(113,'CASE-0047','大胜达-Copy333333','高','压力测试','','','qqeqwqe','','zhaosz',1,4,1,'2026-04-07 03:31:07','2026-04-07 04:39:01','zhaosz','','','自动化','维护中',0,'draft',NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `test_cases` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_execution_logs`
--

DROP TABLE IF EXISTS `test_execution_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_execution_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `plan_case_id` int NOT NULL,
  `log_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '日志类型: INFO, WARNING, ERROR, DEBUG',
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `timestamp` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `metadata` json DEFAULT NULL COMMENT '额外元数据',
  PRIMARY KEY (`id`),
  KEY `plan_case_id` (`plan_case_id`),
  CONSTRAINT `test_execution_logs_ibfk_1` FOREIGN KEY (`plan_case_id`) REFERENCES `test_plan_cases` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_execution_logs`
--

LOCK TABLES `test_execution_logs` WRITE;
/*!40000 ALTER TABLE `test_execution_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `test_execution_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_methods`
--

DROP TABLE IF EXISTS `test_methods`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_methods` (
  `id` int NOT NULL AUTO_INCREMENT,
  `method_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `creator` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `method_id` (`method_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1046 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_methods`
--

LOCK TABLES `test_methods` WRITE;
/*!40000 ALTER TABLE `test_methods` DISABLE KEYS */;
INSERT INTO `test_methods` VALUES (1,'METHOD_001','手动测试','通过人工操作进行测试','admin','2026-03-23 14:43:59','2026-03-23 14:43:59'),(2,'METHOD_002','自动化测试','通过自动化脚本进行测试','admin','2026-03-23 14:43:59','2026-03-23 14:43:59'),(31,'METHOD-1774329456433-728','半手工测试','','zhaosz','2026-03-24 05:17:36','2026-03-24 05:17:36');
/*!40000 ALTER TABLE `test_methods` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_phases`
--

DROP TABLE IF EXISTS `test_phases`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_phases` (
  `id` int NOT NULL AUTO_INCREMENT,
  `phase_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `creator` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `phase_id` (`phase_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_phases`
--

LOCK TABLES `test_phases` WRITE;
/*!40000 ALTER TABLE `test_phases` DISABLE KEYS */;
INSERT INTO `test_phases` VALUES (1,'PHASE-1774329488657-921','v1.0','','zhaosz','2026-03-24 05:18:08','2026-03-24 05:18:22'),(2,'PHASE-1774329497203-183','v2.0','','zhaosz','2026-03-24 05:18:17','2026-03-24 05:18:17'),(3,'PHASE-1774329509707-979','v3.0','','zhaosz','2026-03-24 05:18:29','2026-03-24 05:18:29');
/*!40000 ALTER TABLE `test_phases` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_plan_cases`
--

DROP TABLE IF EXISTS `test_plan_cases`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_plan_cases` (
  `id` int NOT NULL AUTO_INCREMENT,
  `plan_id` int NOT NULL,
  `case_id` int NOT NULL,
  `test_point_id` int DEFAULT NULL COMMENT '一级测试点ID',
  `module_id` int DEFAULT NULL COMMENT '模块ID',
  `executor_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '执行者ID',
  `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '执行状态: Pass, Fail, Block, ASIC_Hang, Core_Dump, Traffic_Drop, pending',
  `execution_time` timestamp NULL DEFAULT NULL COMMENT '执行时间',
  `duration` int DEFAULT NULL COMMENT '执行耗时(秒)',
  `log_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '日志文件路径',
  `error_message` text COLLATE utf8mb4_unicode_ci COMMENT '错误信息',
  `bug_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联的缺陷ID',
  `retry_count` int DEFAULT '0' COMMENT '重试次数',
  `pfc_specific` tinyint(1) DEFAULT '0' COMMENT '是否为PFC专属测试',
  `buffer_test` tinyint(1) DEFAULT '0' COMMENT '是否为Buffer测试',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_plan_case` (`plan_id`,`case_id`),
  KEY `case_id` (`case_id`),
  CONSTRAINT `test_plan_cases_ibfk_1` FOREIGN KEY (`plan_id`) REFERENCES `test_plans` (`id`) ON DELETE CASCADE,
  CONSTRAINT `test_plan_cases_ibfk_2` FOREIGN KEY (`case_id`) REFERENCES `test_cases` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=40 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_plan_cases`
--

LOCK TABLES `test_plan_cases` WRITE;
/*!40000 ALTER TABLE `test_plan_cases` DISABLE KEYS */;
INSERT INTO `test_plan_cases` VALUES (1,1,24,NULL,NULL,'admin','pass',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-03-31 04:56:42'),(2,1,25,NULL,NULL,'admin','blocked',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-03-31 05:14:42'),(3,1,26,NULL,NULL,'admin','pass',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-03-31 05:14:47'),(4,1,27,NULL,NULL,'zhaosz','pass',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-04-01 02:06:49'),(5,1,28,NULL,NULL,'admin','pass',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-03-31 05:15:07'),(6,1,29,NULL,NULL,'zhaosz','blocked',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-04-01 04:26:57'),(7,1,30,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-03-31 03:49:45'),(8,1,31,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-03-31 03:49:45'),(9,1,32,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-03-31 03:49:45'),(10,1,33,NULL,NULL,'zhaosz','blocked',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-04-01 04:27:07'),(11,1,34,NULL,NULL,'admin','pass',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-03-31 05:15:22'),(12,1,35,NULL,NULL,'admin','blocked',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-03-31 05:17:36'),(13,1,36,NULL,NULL,'zhaosz','fail',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-04-01 11:05:45'),(14,1,37,NULL,NULL,'admin','pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-03-31 05:16:54'),(15,1,38,NULL,NULL,'admin','blocked',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-03-31 05:16:58'),(16,1,40,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-03-31 03:49:45'),(17,1,41,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-03-31 03:49:45'),(18,1,42,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-03-31 03:49:45'),(19,1,43,NULL,NULL,'zhaosz','pass',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-04-01 02:24:00'),(20,1,44,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-03-31 03:49:45'),(21,1,45,NULL,NULL,'zhaosz','pass',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-31 03:49:45','2026-04-01 02:24:09'),(22,2,24,NULL,NULL,'zhaosz','pass',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:46'),(23,2,25,NULL,NULL,'zhaosz','pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:54'),(24,2,26,NULL,NULL,'zhaosz','fail',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:36:09'),(25,2,27,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:27'),(26,2,28,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:27'),(27,2,29,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:27'),(28,2,30,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:27'),(29,2,31,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:27'),(30,2,32,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:27'),(31,2,33,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:27'),(32,2,34,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:27'),(33,2,35,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:27'),(34,2,36,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:27'),(35,2,37,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:27'),(36,2,38,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:27'),(37,2,40,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:27'),(38,2,41,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:27'),(39,2,42,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-04-01 10:35:27','2026-04-01 10:35:27');
/*!40000 ALTER TABLE `test_plan_cases` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_plan_rules`
--

DROP TABLE IF EXISTS `test_plan_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_plan_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `plan_id` int NOT NULL,
  `rule_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '规则类型: PRIORITY, AUTOMATION等',
  `rule_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '规则名称',
  `rule_config` json NOT NULL COMMENT '规则配置JSON',
  `priority` int DEFAULT '0' COMMENT '规则优先级',
  `enabled` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `created_by` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `plan_id` (`plan_id`),
  CONSTRAINT `test_plan_rules_ibfk_1` FOREIGN KEY (`plan_id`) REFERENCES `test_plans` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_plan_rules`
--

LOCK TABLES `test_plan_rules` WRITE;
/*!40000 ALTER TABLE `test_plan_rules` DISABLE KEYS */;
/*!40000 ALTER TABLE `test_plan_rules` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_plans`
--

DROP TABLE IF EXISTS `test_plans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_plans` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `owner` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `test_phase` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `project` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `iteration` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `pass_rate` decimal(5,2) DEFAULT NULL,
  `tested_cases` int DEFAULT '0',
  `total_cases` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `stage_id` int DEFAULT NULL COMMENT '测试阶段ID',
  `software_id` int DEFAULT NULL COMMENT '测试软件ID',
  `actual_start_time` datetime DEFAULT NULL COMMENT '实际开始时间',
  `actual_end_time` datetime DEFAULT NULL COMMENT '实际完成时间',
  PRIMARY KEY (`id`),
  KEY `idx_test_plans_owner` (`owner`),
  KEY `idx_test_plans_status` (`status`),
  KEY `idx_test_plans_project` (`project`),
  KEY `idx_test_plans_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_plans`
--

LOCK TABLES `test_plans` WRITE;
/*!40000 ALTER TABLE `test_plans` DISABLE KEYS */;
INSERT INTO `test_plans` VALUES (1,'v2.0 EMUL NetRx测试','cccc','running','未指定','U12项目',NULL,NULL,'2026-03-29','2026-04-03',88.00,13,21,'2026-03-31 03:49:45','2026-04-01 11:05:45',2,1,'2026-04-01 10:06:54',NULL),(2,'213','zhaosz','running','未指定','U12项目',NULL,NULL,'2026-03-29','2026-04-03',50.00,2,18,'2026-04-01 10:35:27','2026-04-01 11:22:01',2,1,'2026-04-01 19:22:01',NULL);
/*!40000 ALTER TABLE `test_plans` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_priorities`
--

DROP TABLE IF EXISTS `test_priorities`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_priorities` (
  `id` int NOT NULL AUTO_INCREMENT,
  `priority_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `creator` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `priority_id` (`priority_id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_priorities`
--

LOCK TABLES `test_priorities` WRITE;
/*!40000 ALTER TABLE `test_priorities` DISABLE KEYS */;
INSERT INTO `test_priorities` VALUES (5,'PRIORITY-1774329402020-248','高','高优先级测试点','zhaosz','2026-03-24 05:16:42','2026-03-24 05:16:42'),(6,'PRIORITY-1774329408490-211','中','','zhaosz','2026-03-24 05:16:48','2026-03-24 05:16:48'),(7,'PRIORITY-1774329414036-449','低','','zhaosz','2026-03-24 05:16:54','2026-03-24 05:16:54');
/*!40000 ALTER TABLE `test_priorities` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_progresses`
--

DROP TABLE IF EXISTS `test_progresses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_progresses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `progress_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `creator` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `status_category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'not_started' COMMENT '进度分类: not_started, in_progress, completed',
  PRIMARY KEY (`id`),
  UNIQUE KEY `progress_id` (`progress_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_progresses`
--

LOCK TABLES `test_progresses` WRITE;
/*!40000 ALTER TABLE `test_progresses` DISABLE KEYS */;
INSERT INTO `test_progresses` VALUES (1,'PROGRESS-1774329674714-476','未开始','','zhaosz','2026-03-24 05:21:14','2026-03-24 05:21:14','not_started'),(2,'PROGRESS-1774329688058-505','100%','','zhaosz','2026-03-24 05:21:28','2026-03-24 05:21:28','not_started');
/*!40000 ALTER TABLE `test_progresses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_reports`
--

DROP TABLE IF EXISTS `test_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_reports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `creator` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `creator_id` int DEFAULT NULL,
  `project` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `iteration` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `test_plan_id` int DEFAULT NULL,
  `report_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `summary` text COLLATE utf8mb4_unicode_ci,
  `has_ai_analysis` tinyint(1) DEFAULT '0',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'ready',
  `job_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `test_plan_id` (`test_plan_id`),
  KEY `idx_test_reports_creator_id` (`creator_id`),
  KEY `idx_test_reports_project` (`project`),
  KEY `idx_test_reports_status` (`status`),
  KEY `idx_test_reports_created_at` (`created_at`),
  CONSTRAINT `test_reports_ibfk_1` FOREIGN KEY (`test_plan_id`) REFERENCES `test_plans` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_reports`
--

LOCK TABLES `test_reports` WRITE;
/*!40000 ALTER TABLE `test_reports` DISABLE KEYS */;
INSERT INTO `test_reports` VALUES (1,'_模块报告_2026-03-26','admin',1,'U12芯片测试','',NULL,'ai-deep','/Users/zhao/Desktop/my_projects/xtest/uploads/reports/report-1-1774496117525.md',0,'ready','job_1774496117245_g14ei5j3y',NULL,NULL,'2026-03-26 03:35:17','2026-03-26 03:35:17');
/*!40000 ALTER TABLE `test_reports` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_softwares`
--

DROP TABLE IF EXISTS `test_softwares`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_softwares` (
  `id` int NOT NULL AUTO_INCREMENT,
  `software_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `creator` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `software_id` (`software_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2089 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_softwares`
--

LOCK TABLES `test_softwares` WRITE;
/*!40000 ALTER TABLE `test_softwares` DISABLE KEYS */;
INSERT INTO `test_softwares` VALUES (1,'SOFTWARE_001','CTCSDK','Centec SDK测试软件','admin','2026-03-23 14:43:59','2026-03-23 14:43:59'),(2,'SOFTWARE_002','Cmodel','芯片仿真模型测试','admin','2026-03-23 14:43:59','2026-03-23 14:43:59'),(3,'SOFTWARE_003','SAI','Switch Abstraction Interface测试','admin','2026-03-23 14:43:59','2026-03-23 14:43:59'),(4,'SOFTWARE_004','ECPU','嵌入式CPU测试','admin','2026-03-23 14:43:59','2026-03-23 14:43:59');
/*!40000 ALTER TABLE `test_softwares` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_sources`
--

DROP TABLE IF EXISTS `test_sources`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_sources` (
  `id` int NOT NULL AUTO_INCREMENT,
  `source_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `creator` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `source_id` (`source_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2601 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_sources`
--

LOCK TABLES `test_sources` WRITE;
/*!40000 ALTER TABLE `test_sources` DISABLE KEYS */;
INSERT INTO `test_sources` VALUES (1,'SOURCE_001','PRD','产品需求文档','admin','2026-03-23 14:43:59','2026-03-23 14:43:59'),(2,'SOURCE_002','客户需求','客户提出的需求','admin','2026-03-23 14:43:59','2026-03-23 14:43:59'),(3,'SOURCE_003','功能特性','功能特性测试','admin','2026-03-23 14:43:59','2026-03-23 14:43:59'),(4,'SOURCE_004','缺陷回归','缺陷修复后的回归测试','admin','2026-03-23 14:43:59','2026-03-23 14:43:59'),(5,'SOURCE_005','技术方案','技术方案相关测试','admin','2026-03-23 14:43:59','2026-03-23 14:43:59');
/*!40000 ALTER TABLE `test_sources` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_statuses`
--

DROP TABLE IF EXISTS `test_statuses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_statuses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `status_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `creator` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `status_category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'pending' COMMENT '状态分类: passed, failed, pending, blocked',
  `sort_order` int DEFAULT '0' COMMENT '排序顺序',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  PRIMARY KEY (`id`),
  UNIQUE KEY `status_id` (`status_id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_statuses`
--

LOCK TABLES `test_statuses` WRITE;
/*!40000 ALTER TABLE `test_statuses` DISABLE KEYS */;
INSERT INTO `test_statuses` VALUES (1,'STATUS-1774329349174-331','未开始','','zhaosz','2026-03-24 05:15:49','2026-03-24 05:15:49','pending',0,1),(5,'STATUS-1774329428068-891','阻塞','','zhaosz','2026-03-24 05:17:08','2026-03-24 05:17:08','pending',0,1),(6,'STATUS-1774329439541-368','暂停','','zhaosz','2026-03-24 05:17:19','2026-03-24 05:17:19','pending',0,1),(7,'STATUS-1774929449070-757','pass','','admin','2026-03-31 03:57:29','2026-03-31 03:57:29','pending',0,1),(8,'STATUS-1774929455064-920','fail','','admin','2026-03-31 03:57:35','2026-03-31 03:57:35','pending',0,1);
/*!40000 ALTER TABLE `test_statuses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `test_types`
--

DROP TABLE IF EXISTS `test_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_types` (
  `id` int NOT NULL AUTO_INCREMENT,
  `type_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `creator` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `type_id` (`type_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `test_types`
--

LOCK TABLES `test_types` WRITE;
/*!40000 ALTER TABLE `test_types` DISABLE KEYS */;
INSERT INTO `test_types` VALUES (1,'TYPE-1774800842409-77','功能测试','','zhaosz','2026-03-29 16:14:02','2026-03-29 16:14:02'),(2,'TYPE-1774800848612-909','性能测试','','zhaosz','2026-03-29 16:14:08','2026-03-29 16:14:08'),(3,'TYPE-1774800854463-93','压力测试','','zhaosz','2026-03-29 16:14:14','2026-03-29 16:14:14'),(4,'TYPE-1774800860001-653','规格测试','','zhaosz','2026-03-29 16:14:20','2026-03-29 16:14:20'),(5,'TYPE-1774800865452-221','异常测试','','zhaosz','2026-03-29 16:14:25','2026-03-29 16:14:25');
/*!40000 ALTER TABLE `test_types` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `testpoint_chips`
--

DROP TABLE IF EXISTS `testpoint_chips`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `testpoint_chips` (
  `id` int NOT NULL AUTO_INCREMENT,
  `testpoint_id` int NOT NULL,
  `chip_id` int NOT NULL,
  `chip_sequence` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_testpoint_chip` (`testpoint_id`,`chip_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `testpoint_chips`
--

LOCK TABLES `testpoint_chips` WRITE;
/*!40000 ALTER TABLE `testpoint_chips` DISABLE KEYS */;
/*!40000 ALTER TABLE `testpoint_chips` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `testpoint_status`
--

DROP TABLE IF EXISTS `testpoint_status`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `testpoint_status` (
  `id` int NOT NULL AUTO_INCREMENT,
  `testpoint_id` int NOT NULL,
  `chip_id` int NOT NULL,
  `test_result` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `test_date` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_testpoint_chip_status` (`testpoint_id`,`chip_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `testpoint_status`
--

LOCK TABLES `testpoint_status` WRITE;
/*!40000 ALTER TABLE `testpoint_status` DISABLE KEYS */;
/*!40000 ALTER TABLE `testpoint_status` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_skill_settings`
--

DROP TABLE IF EXISTS `user_skill_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_skill_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL COMMENT '用户ID',
  `skill_id` int NOT NULL COMMENT '技能ID',
  `is_enabled` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_skill` (`user_id`,`skill_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_skill_id` (`skill_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_skill_settings`
--

LOCK TABLES `user_skill_settings` WRITE;
/*!40000 ALTER TABLE `user_skill_settings` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_skill_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `status` enum('pending','active','disabled') COLLATE utf8mb4_unicode_ci DEFAULT 'active' COMMENT '用户状态: pending-待审核, active-正常, disabled-禁用',
  `email_notify_mentions` tinyint(1) DEFAULT '1' COMMENT '接收@提醒邮件',
  `email_notify_comments` tinyint(1) DEFAULT '1' COMMENT '接收评论提醒邮件',
  `email_notify_likes` tinyint(1) DEFAULT '0' COMMENT '接收被赞提醒邮件',
  `muted_until` timestamp NULL DEFAULT NULL COMMENT '禁言到期时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_users_username` (`username`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'admin','$2a$10$PW0cUUh9XTFtPbzHeB.o0ueX/9AHFkDJCBisM2t9iXJ27dj9byh9m','管理员','admin@example.com','2026-03-23 14:43:59','2026-03-23 14:43:59','active',1,1,0,NULL),(2,'tester1','$2a$10$/9FhtexBGrbNZQQWQSQUuOtQvBw/hyKHckzpQ/QZVRuE/QbxLWN6K','测试人员','tester1@example.com','2026-03-23 14:43:59','2026-03-23 14:43:59','active',1,1,0,NULL),(3,'zhaosz','$2a$10$GZu50cy9rGuqKkLYMo8W2OElebfXKLHR3FBzguoswKSEBjjkmDGfS','管理员','zhaosz@centec.com','2026-03-24 04:40:18','2026-03-24 04:40:18','active',1,1,0,NULL),(4,'cccc','$2a$10$/bcVjchv.HIdxkUJrYnO5O6ffgEXieAO678acZ3FQLLbs5SYwrzbW','测试人员','cccc@centec.com','2026-03-30 11:23:48','2026-03-30 11:23:48','active',1,1,0,NULL),(5,'xxxx','$2a$10$FFBVSmWbw7HQNOpRWZsireNlJYxd9fsN1vBuKQyfgv.1EfBPEwJ4S','测试人员','xxxx@123.com','2026-03-31 13:07:24','2026-03-31 13:07:24','active',1,1,0,NULL);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping events for database 'xtest_db'
--

--
-- Dumping routines for database 'xtest_db'
--
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-07 13:23:07
