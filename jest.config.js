module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.test.js"],
  setupFiles: ["<rootDir>/test/setup/foundry-mock.js"],
  transform: {
    "^.+\\.m?js$": "babel-jest"
  }
};
