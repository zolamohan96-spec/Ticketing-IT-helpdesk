const userStore = require('./userStore');

function authenticate(inputUsername, inputPassword) {
  return userStore.authenticate(inputUsername, inputPassword);
}

module.exports = {
  username: process.env.ADMIN_USERNAME || 'admin',
  authenticate,
  userStore
};
