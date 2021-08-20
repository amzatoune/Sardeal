const rx = require('rx');
const Discord = require('discord.js');
const dotenv = require('dotenv');

dotenv.config();

class Bot {
    constructor(token){
        this.disClient = new Discord.Client();
        this.disClient.login(token);
    }

    send_a_reply() {
        rx.Observable.fromEvent(this.disClient, 'message')
          .subscribe(() => {console.log('hey were in'); 
          
          });
}
}

oneBot = new Bot(process.env.TOKEN);



var mockUpload = function(outputFile) { let img = jimp.read(outputFile); return promisify(img.getBuffer(jimp.MIME_PNG, (err, buffer) => {
    return new Promise(function(resolve, reject) {
      resolve({
        data: {buffer},
      });
    });
  }));
};
