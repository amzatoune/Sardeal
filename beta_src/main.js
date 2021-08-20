try {
  const dotenv = require('dotenv');
  dotenv.config();
  var token = process.env.TOKEN;
} catch (error) {
  console.log("Your API token should be placed in a '.env' file, which is missing.");
  return;
}

var Bot = require('./bot');
var bot = new Bot(token);
bot.login();
