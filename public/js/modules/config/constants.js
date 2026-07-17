const API_BASE_URL = (function () {
    const origin = window.location.origin;
    return origin + '/api';
})();

const DataEvents = {
    TEST_CASE_CHANGED: 'testCaseDataChanged',
    MODULE_CHANGED: 'moduleDataChanged',
    LEVEL1_POINT_CHANGED: 'level1PointChanged',
    EXECUTION_RECORD_CHANGED: 'executionRecordChanged',
    DASHBOARD_REFRESH: 'dashboardRefresh'
};

const APP_CONFIG = {
    DEFAULT_PAGE_SIZE: 32,
    CACHE_TTL: 5 * 60 * 1000,
    SAVE_DELAY: 500,
    MAX_FILE_SIZE: 10 * 1024 * 1024
};

const ROUTES = {
    WORKSPACE: 'workspace',
    DASHBOARD: 'dashboard',
    CASES: 'cases',
    TESTPLANS: 'testplans',
    REPORTS: 'reports',
    SETTINGS: 'settings',
    LOGIN: 'login',
    REGISTER: 'register'
};

const STATUS = {
    NOT_STARTED: 'not_started',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    PAUSED: 'paused',
    CANCELLED: 'cancelled'
};

const PRIORITY = {
    P0: 'P0',
    P1: 'P1',
    P2: 'P2',
    P3: 'P3'
};
