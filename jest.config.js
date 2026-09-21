module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.test.js"],
  transform: {
    "^.+\\.m?js$": "babel-jest"
  }
};
