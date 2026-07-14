module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    'no-void': ['error', { allowAsStatement: true }],
  },
  overrides: [
    {
      files: ['jest-setup.js'],
      env: { jest: true },
    },
  ],
};
