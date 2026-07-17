/**
 * 测试数据库Mock配置
 * 用于集成测试
 */

const mockExecute = jest.fn();
const mockQuery = jest.fn();
const mockGetConnection = jest.fn();

const mockConnection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    execute: mockExecute,
    query: mockQuery,
    release: jest.fn()
};

const mockPool = {
    execute: mockExecute,
    query: mockQuery,
    getConnection: mockGetConnection.mockResolvedValue(mockConnection),
    on: jest.fn(),
    end: jest.fn().mockResolvedValue(undefined)
};

module.exports = {
    mockPool,
    mockConnection,
    mockExecute,
    mockQuery,
    mockGetConnection,
    resetMocks: () => {
        mockExecute.mockReset();
        mockQuery.mockReset();
        mockGetConnection.mockReset();
        mockConnection.beginTransaction.mockReset().mockResolvedValue(undefined);
        mockConnection.commit.mockReset().mockResolvedValue(undefined);
        mockConnection.rollback.mockReset().mockResolvedValue(undefined);
        mockConnection.release.mockReset();
        mockGetConnection.mockResolvedValue(mockConnection);
    },
    mockDb: mockPool
};
