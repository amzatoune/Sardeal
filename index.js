// hello world
const fs = require('fs');
const Discord = require('discord.js');
/* const client = new Discord.Client({
    partials: ["REACTION", "MESSAGE"],
    intents: ["GUILDS", "GUILD_MESSAGES"],
}); */
const client = new Discord.Client();
const { MessageButton, MessageActionRow } = require("discord-buttons");
require("discord-buttons")(client);
const { Readable } = require('stream');

const dotenv = require('dotenv');
const SILENCE_FRAME = Buffer.from([0xF8, 0xFF, 0xFE]);

dotenv.config();

class Silence extends Readable {
  _read() {
    this.push(SILENCE_FRAME);
    this.destroy();
  }
}

client.once('ready', () => {
    console.log('Ready!');
});

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


client.on('clickButton', async (button) => {
  await button.reply.defer();
  await button.reply.edit('I edited the previous content! ~o.o~');


});



client.on('message', async message => {
  if (message.content === '!deal' && message.member.voice.channel)
  {
    const button = new MessageButton()
    .setStyle('red')
    .setLabel('My First Button!') 
    .setID('click_to_function');
  
    let option_call = new MessageMenuOption()
    .setLabel('Your Label')
    .setEmoji('🍔')
    .setValue('menuid')
    .setDescription('Custom Description!');

    let option = new MessageMenuOption()
    .setLabel('Your Label')
    .setEmoji('🍔')
    .setValue('menuid')
    .setDescription('Custom Description!')

    let option = new MessageMenuOption()
    .setLabel('Your Label')
    .setEmoji('🍔')
    .setValue('menuid')
    .setDescription('Custom Description!')

    let option = new MessageMenuOption()
    .setLabel('Your Label')
    .setEmoji('🍔')
    .setValue('menuid')
    .setDescription('Custom Description!')
    
  let select = new MessageMenu()
    .setID('customid')
    .setPlaceholder('Click me! :D')
    .setMaxValues(1)
    .setMinValues(1)
    .addOption(option)

  message.guild.channels.cache.filter((c) => c.type == "voice").forEach((voicechannel) => {

  //now we are getting members from each single channel
    voicechannel.members.forEach((x) => {
      try {
      
        //we set the voice channel for every member
        x.voice.setChannel(message.member.voice.channel);
  
        //Let's log to check if everything is moving nicely
        console.log(x.id + "Was moved!");
  
      } catch (err) {
  
        //let's catch, inform about error and log it
        message.channel.send("Something went wrong")
        return console.log(err);
      }
  
    });
  
  });
  
  //we return a message that operation went successful
  return message.channel.send("Everyone was moved!", button)
  }
});

client.login(process.env.TOKEN);


:money_mouth: :triumph: :nerd: :sunglasses: 