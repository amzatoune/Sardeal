// hello world
const Deck = require('./beta_src/deck');
const ImageHelpers = require('./beta_src/image-helpers');
const fs = require('fs');
const Discord = require('discord.js');
const dotenv = require('dotenv');
const rx = require('rx');
const jimp = require('jimp');
const MessageHelpers = require('./beta_src/message-helpers');
/* const client = new Discord.Client({
    partials: ["REACTION", "MESSAGE"],
    intents: ["GUILDS", "GUILD_MESSAGES"],
}); */
const intents = new Discord.Intents(Discord.Intents.NON_PRIVILEGED);
intents.add('GUILD_MEMBERS');
//export const client: Client = new Client({ ws: {intents: intents} });
const client = new Discord.Client({ ws: { intents: intents } });

const { MessageButton, MessageActionRow, MessageMenuOption, MessageMenu } = require("discord-buttons");
require("discord-buttons")(client);
const { Readable } = require('stream');


const SILENCE_FRAME = Buffer.from([0xF8, 0xFF, 0xFE]);

dotenv.config();

class Silence extends Readable {
  _read() {
    this.push(SILENCE_FRAME);
    this.destroy();
  }
}

rx.Observable.fromEvent(client, 'ready')
          .finally().subscribe(() => {
            console.log(client.users.cache.get(client.user.id));
        });

// client.once('ready', () => {
//     console.log('Ready!');
// });

client.on('message', async message => {
    if (message.content === 's' && message.member.voice.channel) {
        const connection = await message.member.voice.channel.join();
        const audio = connection.receiver.createStream('714177692487909446', { mode: 'pcm', end: 'manual' });
        //const audio = connection.receiver.createStream('354788738078867456', { mode: 'pcm', end: 'manual' });
        //const audio = connection.receiver.createStream(message, { mode: 'pcm', end: 'manual' });
        audio.pipe(fs.createWriteStream('user_audio'));
        connection.play(new Silence(), { type: 'opus' });
        console.log(message.member.user.id);
    }
});



client.on('message', async message => {
  if (message.content.includes('!jimp'))
  {
    // let pic = await mockUpload("resources/3c.png");
    // let buffer = await pic.getBufferAsync(jimp.MIME_PNG);

    // pic.getBuffer(jimp.MIME_PNG, (err, buffer) => {
    //   const attachment = new Discord.MessageAttachment(buffer, 'file.png');
    //   message.channel.send(attachment);
    // });
    //console.log(message.member.user);
    console.log("\n");
    let user = client.users.cache.get(message.author.id);
    //console.log(client.user.cache);
    const id = '728191727482961991';
    const guild = client.guilds.cache.find((g) => g.id === id);

    if (!guild)
    return console.log(`Can't find any guild with the ID "${id}"`);

    guild.members
    .fetch()
    .then((members) =>
      members.forEach((member) => { if (member.user.id == "804729395544981525") { member.send('Hello'); }}),
    );
    const buffer = Buffer.from('Text in file');
    const attachment = new Discord.MessageAttachment(buffer, 'file.txt');
    user.send("Hello there file", attachment);
    console.log(message.member.user);
    console.log("****\n");
    console.log(message.author)
    
    
    
    
  }
});


client.on('message', async message => {
  if (message.content.includes('!hand'))
  {
    let show_card_images = 1;
    let playerHand = [];
    let deck = new Deck();
    deck.shuffle();
    let card = deck.drawCard();
    playerHand.push(card);
    card = deck.drawCard();
    playerHand.push(card);

    if (show_card_images==1) {
      ImageHelpers.createPlayerHandImage(playerHand)
      .timeout(4000)
      .flatMap(buffer => {
        console.log(buffer);
        let message_attachment = new Discord.MessageAttachment(buffer, 'hand.png');


        message.channel.send(`Your hand is:`, message_attachment);

        // NB: Since we don't have a callback for the message arriving, we're
        // just going to wait a second before continuing.
        return rx.Observable.timer(1000, this.scheduler);
      })
      .take(1)
      .catch(() => {
        console.error('Creating hand image timed out');
        message.channel.send(`Your hand is: ${this.playerHands}`);
        return rx.Observable.timer(1000, this.scheduler);
      })
      .subscribe();
    }
    else {
      message.channel.send(`Your hand is: ${this.playerHands}`);
      return rx.Observable.timer(1000, this.scheduler);
    }
  }
});



client.on('clickButton', async (button) => {
  await button.reply.defer();
  switch (button.id)
  {
    case "raise": 
      // await button.reply.think(true)
      await button.reply.edit('I raised! ~o.o~$');
      // await button.reply.send('You raised!', true);
      break;
    case "check":
      await button.reply.edit('I checked! ~o.o~');
      break;
    case "bet":
      await button.reply.edit('I bet! ~o.o~');
      break;
    case "fold":
      await button.reply.edit('I folded! ~o.o~');
      break;
    default:
      await button.reply.edit('I edited the previous content! ~o.o~');

  }

});

rx.Observable.fromEvent(client, 'message')
          .subscribe((message) => {
  if (message.content === '!timeout'){
  let formatMessage = t => `Who wants to play? Respond with 'yes' in this channel in the next ${t} seconds.`;
  let timeout = 30;
  let scheduler=rx.Scheduler.timeout;
  let sent = false;
  message.channel.send(formatMessage(timeout))
  .then((result) => {
    sent = result;
  })
  .catch(console.error);

  let timeExpired = rx.Observable.timer(0, 1000, scheduler)
  .take(timeout + 1)
  .do((x) => { 
    if (sent) {
      sent.edit(formatMessage(`${timeout - x}`))
      .then((result) => {
        //sent = result;
      })
      .catch(console.error);  
    }
  
  })
  .publishLast()
  .connect();
  }
})


// client.on('message', async message => {
//   if (message.content === '!timeout'){
//   let formatMessage = t => `Who wants to play? Respond with 'yes' in this channel in the next ${t} seconds.`;
//   let timeout = 30;
//   let scheduler=rx.Scheduler.timeout;
//   let sent = false;
//   message.channel.send(formatMessage(timeout))
//   .then((result) => {
//     sent = result;
//   })
//   .catch(console.error);

//   let timeExpired = rx.Observable.timer(0, 1000, scheduler)
//   .take(timeout + 1)
//   .do((x) => { 
//     if (sent) {
//       sent.edit(formatMessage(`${timeout - x}`))
//       .then((result) => {
//         sent = result;const TexasHoldem = require('./texas-holdem');
//       })
//       .catch(console.error);  
//     }
  
//   })
//   .publishLast()
//   .connect();
//   }
// })




client.on('message', async message => {
  // if (message.content === '!deal' && message.member.voice.channel)
  if (message.content === '!deal')
  {

    let button_raise = new MessageButton()
    .setStyle('blurple')
    .setLabel('Raise')
    .setEmoji('😈')
    .setID('raise');

    let button_bet = new MessageButton()
    .setStyle('red')
    .setLabel('Bet')
    .setEmoji('👽')
    .setID('bet');

    let button_check = new MessageButton()
    .setStyle('green')
    .setLabel('Check')
    .setEmoji('🤖')
    .setID('check');

    let button_fold = new MessageButton()
    .setStyle('grey')
    .setLabel('Fold')
    .setEmoji('👿')
    .setID('fold');

    let row = new MessageActionRow()
  .addComponents(button_raise, button_bet, button_check, button_fold);

    /*let option_raise = new MessageMenuOption()
    .setLabel('Raise')
    .setEmoji('😈')
    .setValue('raiseid')
    .setDescription('Custom Description!');

    let option_bet = new MessageMenuOption()
    .setLabel('Bet')
    .setEmoji('👽')
    .setValue('betid')
    .setDescription('Custom Description!');

    let option_check = new MessageMenuOption()
    .setLabel('Check')
    .setEmoji('🤖')
    .setValue('checkid')
    .setDescription('Custom Description!');

    let option_fold = new MessageMenuOption()
    .setLabel('Fold')
    .setEmoji('👿')
    .setValue('foldid')
    .setDescription('Custom Description!');
    
  let select = new MessageMenu()
    .setID('customid')
    .setPlaceholder('Click me! :D')
    .setMaxValues(1)
    .setMinValues(1)
    .addOption(option_bet)
    .addOption(option_check)
    .addOption(option_fold);*/

  // message.guild.channels.cache.filter((c) => c.type == "voice").forEach((voicechannel) => {

  // //now we are getting members from each single channel
  //   voicechannel.members.forEach((x) => {
  //     try {
      
  //       //we set the voice channel for every member
  //       x.voice.setChannel(message.member.voice.channel);
  
  //       //Let's log to check if everything is moving nicely
  //       console.log(x.id + "Was moved!");
  
  //     } catch (err) {
  
  //       //let's catch, inform about error and log it
  //       message.channel.send("Something went wrong")
  //       return console.log(err);
  //     }
  
  //   });
  
  // });
  
  //we return a message that operation went successful
  console.log(message.channel);
  return message.channel.send(`Everyone was moved!`, row)
  }
});

client.login(process.env.TOKEN);

// 😈 👿 👽 🤖 :money_mouth: :triumph: :nerd: :sunglasses: 
