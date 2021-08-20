const rx = require('rx');
const _ = require('underscore-plus');
const TexasHoldem = require('./texas-holdem');
const PlayerInteraction = require('./player-interaction');
const WeakBot = require('../ai/weak-bot');
const AggroBot = require('../ai/aggro-bot');
const MessageHelpers = require('./message-helpers');
const Discord = require('discord.js');


class Bot {
  // Public: Creates a new instance of the bot.
  //
  // token - An API token from the bot integration
  constructor(token) {
    this.discordClient = new Discord.Client();

    this.gameConfig = { 
      timeout: 45, 
      maxplayers: 25, 
      start_game_timeout: 7, 
      bots: 1,
      smallblind: 4,
      initialstash: 2000,
      show_card_images: 1
    };

    this.gameConfigDescs = {
      timeout: `How long to wait for players to make each move. Set to 0 to wait forever. (default ${this.gameConfig.timeout})`,
      maxplayers: `Maximum players per table. (default ${this.gameConfig.maxplayers})`,
      start_game_timeout: `How many seconds to wait for players to sign up before starting the game. (default ${this.gameConfig.start_game_timeout})`,
      bots: `Set this to 1 to include autobot players for testing (default ${this.gameConfig.bots})`,
      smallblind: `Initial small blind. (default ${this.gameConfig.smallblind})`,
      initialstash: `Starting value of chips for each player. (default ${this.gameConfig.initialstash})`,
      show_card_images: `Display images of cards (0=no, 1=yes). (default ${this.gameConfig.show_card_images})`
    }

    this.isGameRunning = {};
    this.isPolling = {};
    this.token = token;
  }

  // Public: Brings this bot online and starts handling messages sent to it.
  login() {
    
    rx.Observable.fromEvent(this.discordClient, 'ready')
    .finally().subscribe(() => {
    this.onClientOpened();
    //console.log('Listeniing..');
    });

    this.discordClient.login(this.token)
      .catch(err => {
        console.log("Dis-cord authentication failed. Check that your_BOT_TOKEN is valid");
        process.exit(1);
      });
    
    this.respondToMessages();
    

  }

  // Private: Listens for messages directed at this bot 
  // and poll players in response.
  //
  // Returns a {Disposable} that will end this subscription
  respondToMessages() {
    let messages = rx.Observable.fromEvent(this.discordClient, 'message')
      .where(e => e.type === 'DEFAULT');
    //console.log(this.discordClient.user.username);
    let atMentions = messages.where(e =>
      MessageHelpers.containsUserMention(e.content, this.discordClient.user.id));
    let disp = new rx.CompositeDisposable();

    disp.add(this.handleStartGameMessages(messages, atMentions));
    disp.add(this.handleSetConfigMessages(atMentions));
    disp.add(this.handleGetConfigMessages(atMentions));
    disp.add(this.handleHelpMessages(atMentions));

    return disp;
  }

  // Private: Looks for messages directed at the bot that contain the word
  // "game." When found, start polling players for a game.
  //
  // messages - An {Observable} representing messages posted to a channel
  // atMentions - An {Observable} representing messages directed at the bot
  //
  // Returns a {Disposable} that will end this subscription

  handleStartGameMessages(messages, atMentions) {
    return atMentions
      .where(e => e.content && e.content.toLowerCase().match(/\bgame\b/))
      .map(e => e.channel)
      .where(channel => {
        if (channel in this.isPolling && this.isPolling[channel]) {
          return false;
        } else if (channel in this.isGameRunning && this.isGameRunning[channel]) {
          channel.send('Another game is in progress, quit that first.');
          return false;
        }
        return true;
      })
      .flatMap(channel => this.pollPlayersForGame(messages, channel))
      .subscribe();
  }

  // Private: Looks for messages directed at the bot that contain the word
  // "config" and have valid parameters. When found, set the parameter.
  //
  // atMentions - An {Observable} representing messages directed at the bot
  //
  // Returns a {Disposable} that will end this subscription
  handleSetConfigMessages(atMentions) {
    return atMentions
      .where(e => e.content && e.content.toLowerCase().includes('config'))
      .subscribe(e => {

        e.content.replace(/(\w*)=(\d*)/g, (match, key, value) => {
          if (key in this.gameConfig && value) {
            this.gameConfig[key] = value;
            e.channel.send(`Game config ${key} has been set to ${value}.`);
          }
          else {
            let message = `Unknown configuration option ${key}.\n\nValid options are:\n\`\`\``;
            for (let option in this.gameConfig) {
              let desc = this.gameConfigDescs[option];
              message = message + `${option}: ${desc}\n`;
            }
            message = message + '```';
            e.channel.send(message);
          }
        });
      });
  }

  // Private: Looks for messages directed at the bot that contain the word
  // "config" but nothing else.
  //
  // atMentions - An {Observable} representing messages directed at the bot
  //
  // Returns a {Disposable} that will end this subscription
  handleGetConfigMessages(atMentions) {
    return atMentions
      .where(e => e.content && e.content.toLowerCase().match(/\bconfig\b/))
      .subscribe(e => {
        let message = `Current configuration values\n\`\`\``;
        //TODO: make this get config of current game in progress (if any)
        //rather than new game settings
        for (let option in this.gameConfig) {
          message = message + `${option}: ${this.gameConfig[option]}\n`;
        }
        message = message + '```';
        e.channel.send(message);
      });
  }

//   channel = message.channel.id
//   client.channels.cache.get('CHANNEL ID').

//   handleGetConfigMessages(atMentions) {
//     return atMentions
//       .where(e => e.content && e.content.toLowerCase().match(/\game\b/))
//       .subscribe(e => {
//         let scheduler=rx.Scheduler.timeout;
//         let timeout=30;
//         let formatMessage = t => `Who wants to play? Respond with 'yes' in this channel in the next ${t} seconds.`;
//         let timeExpired = PlayerInteraction.postMessageWithTimeout(this.discordClient, e.channel, formatMessage, scheduler, timeout);
//         timeExpired.connect();
//       });
//   }

  // Private: Looks for messages directed at the bot that contain the word
  // "help". When found, explain how to start new game.
  //
  // atMentions - An {Observable} representing messages directed at the bot
  //
  // Returns a {Disposable} that will end this subscription

  handleHelpMessages(atMentions) {
    return atMentions
      .where(e => e.content && e.content.toLowerCase().match(/\bhelp\b/))
      .subscribe(e => {
        e.channel.send("Type `@" + this.botInfo.username + " game` to start a new game of Texas Hold'em");
        e.channel.send("Type `@" + this.botInfo.username + " deal` to deal the next hand");
        e.channel.send("Type `@" + this.botInfo.username + " increase blinds` to bump the blinds");
        e.channel.send("Type `@" + this.botInfo.username + " config` to review settings",);
        e.channel.send("Type `@" + this.botInfo.username + " config <key>=<value>` to adjust settings before starting a game");
      });
  }

  // Private: Polls players to join the game, and if we have enough, starts an
  // instance.
  //
  // messages - An {Observable} representing messages posted to the channel
  // channel - The channel where the 'game' message was posted
  //
  // Returns an {Observable} that signals completion of the game 
//================================
  pollPlayersForGame(messages, channel) {
    this.isPolling[channel] = true;
    return PlayerInteraction.pollPotentialPlayers(messages, this.discordClient, channel, this.gameConfig.start_game_timeout, this.gameConfig.maxplayers)
      .reduce((players, user) => {
        channel.send(`@${user.username} has joined the game.`);
        players.push({ id: user.id, name: user.username });
        return players;
      }, [])
      .flatMap(players => {
        this.isPolling[channel] = false;
        if (this.gameConfig.bots != 0) {
          this.addBotPlayers(players);
        }

        let messagesInChannel = messages.where(e => e.channel === channel);
        console.log(players);
        return this.startGame(messagesInChannel, channel, players);
      });
  }

  // Private: Starts and manages a new Texas Hold'em game.
  //
  // messages - An {Observable} representing messages posted to the channel
  // channel - The channel where the game will be played
  // players - The players participating in the game
  //
  // Returns an {Observable} that signals completion of the game 
  startGame(messages, channel, players) {
    if (players.length <= 1) {
      channel.send('Not enough players for a game, try again later.');
      return rx.Observable.return(null);
    }

    channel.send(`We've got ${players.length} players, let's start the game.`);
    this.isGameRunning[channel] = true;

    let game = new TexasHoldem(this.discordClient, messages, channel, players, this.gameConfig);
    // TODO: clean this up?
    _.extend(game, this.gameConfig);

    // Listen for messages directed at the bot containing 'quit game.'
    let quitGameDisp = messages.where(e => MessageHelpers.containsUserMention(e.content, this.discordClient.user.id) &&
      e.content.toLowerCase().match(/quit game/))
      .take(1)
      .subscribe(e => {
            let user = this.discordClient.users.cache.get(e.author.id);
            channel.send(`${user.username} has decided to quit the game. The game will end after this hand.`);
            game.quit();
      });
    //   .subscribe(e => {
    //     this.discordClient.users.cache.get(e.author.id)
    //       .then((result) => {
    //         let user = result;
    //         channel.send(`${user.username} has decided to quit the game. The game will end after this hand.`);
    //         game.quit();
    //       })
    //       .catch(console.error);
    //   });

    // Listen for messages directed at the bot containing 'deal'
    let dealHandDisp = messages.where(e => MessageHelpers.containsUserMention(e.content, this.discordClient.user.id) &&
      e.content.toLowerCase().match(/deal/))
      .takeUntil(game.gameEnded)
      .subscribe(e => {
        this.discordClient.users.cache.get(e.author.id);
        game.playHand();
      });
    //   .subscribe(e => {
    //     this.discordClient.users.cache.get(e.author.id)
    //       .then((result) => {
    //         game.playHand();
    //       })
    //       .catch(console.error);
    //   });
    // Listen for messages directed at the bot containing 'increase blinds'
    let increaseBlindsDisp = messages.where(e => MessageHelpers.containsUserMention(e.content, this.discordClient.user.id) &&
      e.content.toLowerCase().match(/increase blinds/))
      .takeUntil(game.gameEnded)
      .subscribe(e => {
        this.discordClient.users.cache.get(e.author.id);
        game.increaseBlinds();
      });
    //   .subscribe(e => {
    //     this.discordClient.users.cache.get(e.author.id)
    //       .then((result) => {
    //         game.increaseBlinds();
    //       })
    //       .catch(console.error);
    //   });

    let ret = rx.Observable.fromArray(players)
    //   .flatMap((user) => rx.Observable.return(_.find(this.dms, d => d.user.id == user.id)))
      .flatMap((user) => rx.Observable.return(MessageHelpers.find_a_dm(this.dms, user.id)))
      .reduce((acc, x) => {
        if (x) {
          acc[x.user.id] = x;
        }
        return acc;
      }, {})
      .publishLast();

    ret.connect();

    return ret
      .flatMap(playerDms => rx.Observable.timer(2000)
        .flatMap(() => game.start(playerDms)))
      .do(() => {
        quitGameDisp.dispose();
        dealHandDisp.dispose();
        increaseBlindsDisp.dispose();
        this.isGameRunning[channel] = false;
      });
  }

  // Private: Adds AI-based players (primarily for testing purposes).
  //
  // players - The players participating in the game
  addBotPlayers(players) {
    let bot1 = new WeakBot('Phil Hellmuth');
    players.push(bot1);

    let bot2 = new AggroBot('Phil Ivey');
    players.push(bot2);
  }
//================================

  // Private: Starts and manages a new Texas Hold'em game.
  //
  // messages - An {Observable} representing messages posted to the channel
  // channel - The channel where the game will be played
  // players - The players participating in the game
  //
  // Returns an {Observable} that signals completion of the game 
  

  // Private: Save which channels and groups this bot is in and log them.
  onClientOpened() {
    try {
    this.botInfo = this.discordClient.user;
    console.log(`Welcome to Dis-cord. You are ${this.botInfo.username} with the ID: ${this.botInfo.id}`);
      }
    catch (error) {
    // Error :/
    console.log('Bot info error:');
    console.log(error);
    };


    const id = '728191727482961991';
    const guild = this.discordClient.guilds.cache.find((g) => g.id === id);
    if (guild) {
    guild.members
    .fetch()
    .then((members) => {
    this.dms = members;
    // console.log(this.dms.get('714177692487909446'));
    // function get_first(collection)
    // {
    //     let found = undefined;
    //     members.every((member) => { if (member.user.id == '714177692487909446') {found = member; return false;} return true; });
    //     return found;
    // }
    // console.log(MessageHelpers.find_a_dm(this.dms, '714177692487909446'));
    // console.log(_.filter(this.dms, d => d.user.id === '714177692487909446'));
    //console.log(members);
    if (this.dms.size > 0) {
        console.log(`Your open DM's: ${this.dms.map(dm => dm.user.id).join(', ')}`);
    }
	else {
          console.log('No dms');
	}
      }).catch(console.error);
    }
}
}

module.exports = Bot;
