class BaseTaskHandler {
  constructor(taskType) {
    this.taskType = taskType;
  }

  async execute(task) {
    throw new Error('子类必须实现 execute 方法');
  }

  async validate(task) {
    return true;
  }

  async prepare(task) {
    return {};
  }

  async cleanup(task) {
  }
}

module.exports = BaseTaskHandler;
