const rx = require('rx');
const _ = require('underscore-plus');
const { MessageButton, MessageActionRow, MessageMenuOption, MessageMenu } = require("discord-buttons");


class PlayerInteraction {
  // Public: Poll players that want to join the game during a specified period
  // of time.
  //
  // messages - An {Observable} representing new messages sent to the channel
  // channel - The {Channel} object, used for posting messages
  // timeout - (Optional) The amount of time to conduct polling, in seconds
  // maxPlayers - (Optional) The maximum number of players to allow
  // scheduler - (Optional) The scheduler to use for timing events
  //
  // Returns an {Observable} that will `onNext` for each player that joins and
  // `onCompleted` when time expires or the max number of players join.
  static pollPotentialPlayers(messages, client, channel, timeout=30, maxPlayers=10, scheduler=rx.Scheduler.timeout) {
    let formatMessage = t => `Who wants to play? Respond with 'yes' in this channel in the next ${t} seconds.`;
    let timeExpired = PlayerInteraction.postMessageWithTimeout(channel, formatMessage, scheduler, timeout);
    // Look for messages containing the word 'yes' and map them to a unique
    // user ID, constrained to `maxPlayers` number of players.

    let newPlayers = messages.where(e => e.content && e.author.id != client.user.id && e.content.toLowerCase().match(/\byes\b/))
      .map(e => e.author)
      .distinct()
      .take(maxPlayers)
      .publish();

    newPlayers.connect();

    timeExpired.connect();
    // Once our timer has expired, we're done accepting new players.
    return newPlayers.takeUntil(timeExpired);
  }

  // Public: Poll a specific player to take a poker action, within a timeout.
  //
  // messages - An {Observable} representing new messages sent to the channel
  // channel - The {Channel} object, used for posting messages
  // player - The player being polled
  // previousActions - A map of players to their most recent action
  // scheduler - (Optional) The scheduler to use for timing events
  // timeout - (Optional) The amount of time to conduct polling, in seconds
  //
  // Returns an {Observable} indicating the action the player took. If time
  // expires, a 'timeout' action is returned.
  static getActionForPlayer(client, messages, clicks, channel, player, previousActions, scheduler=rx.Scheduler.timeout, timeout=30) {
    let availableActions = PlayerInteraction.getAvailableActions(player, previousActions);
    let formatMessage = t => PlayerInteraction.buildActionMessage(player, availableActions, t);
    
    let timeExpired = null;
    let expiredDisp = null;
    if (timeout > 0) {
      timeExpired = PlayerInteraction.postMessageWithTimeout(channel, formatMessage, scheduler, timeout);
      expiredDisp = timeExpired.connect();
    } else {
      channel.send(formatMessage(0));
      timeExpired = rx.Observable.never();
      expiredDisp = rx.Disposable.empty;
    }

    // Look for text that conforms to a player action.
    // let playerAction = messages.where(e => e.author.id === player.id)
    //   .map(e => PlayerInteraction.actionFromMessage(e.content, availableActions, player))
    //   .where(action => action !== null)
    //   .publish();

    // playerAction.connect();
    let playerAction = clicks.where(b => b.clicker.id === player.id)
    .map(b => PlayerInteraction.actionFromMessage(b.id, availableActions, player))
    .where(action => action !== null)
    .publish();

    playerAction.connect();

    
    // If the user times out, they will be auto-folded unless they can check.
    let actionForTimeout = timeExpired.map(() =>
      availableActions.indexOf('check') > -1 ?
        { name: 'check' } :
        { name: 'fold' });

    let botAction = player.isBot ?
      player.getAction(availableActions, previousActions) :
      rx.Observable.never();

    // NB: Take the first result from the player action, the timeout, and a bot
    // action (only applicable to bots).
    return rx.Observable.merge(playerAction, actionForTimeout, botAction)
      .take(1)
      .do(() => expiredDisp.dispose());
  }

  // Private: Posts a message to the channel with some timeout, that edits
  // itself each second to provide a countdown.
  //
  // channel - The channel to post in
  // formatMessage - A function that will be invoked once per second with the
  //                 remaining time, and returns the formatted message content
  // scheduler - The scheduler to use for timing events
  // timeout - The duration of the message, in seconds
  //
  // Returns an {Observable} sequence that signals expiration of the message
  static postMessageWithTimeout(channel, formatMessage, scheduler, timeout) {
    let sent = false;
    
    // client.channels.cache.get(channel.id).send(formatMessage(timeout))
    channel.send(formatMessage(timeout))
    .then((result) => {
      sent = result;
      //sent.react('🍎');
    })
    .catch(console.error);

    let timeExpired = rx.Observable.timer(0, 2000, scheduler)
    .take((timeout / 2) + 1)
    .do((x) => { 
      let timeout_msg = 0;
      if (sent) {
        if(x >= (timeout / 2)) {timeout_msg = timeout - (2 * x) + 1;}
        else {timeout_msg = timeout - (2 * x);}
        sent.edit(formatMessage(`${timeout_msg}`))
        .then((result) => {
          sent = result;
          //result.delete({ timeout: (timeout + 1 - x) * 1000 }).then().catch(e=>{console.log(e)});
        })
        .catch(console.error);
      }
    })

    // let timeExpired = rx.Observable.timer(0, 1000, scheduler)
    // .take(timeout + 1)
    // .do((x) => {
    //   if (sent) {
    //     sent.edit(formatMessage(timeout - x))
    //     .then((result) => {
    //       sent = result;
    //     })
    //     .catch(console.error);
    //   }
    // })
    .finally(()=>{if (sent) {sent.delete();}})
    .publishLast();
    
    return timeExpired;

  }

  // Private: Builds up a formatted countdown message containing the available
  // actions.
  //
  // player - The player who is acting
  // availableActions - An array of the actions available to this player
  // timeRemaining - Number of seconds remaining for the player to act
  //
  // Returns the formatted string

  static buildActionMessage(player, availableActions, timeRemaining) {
    let message = (player.isBot?`${player.name}`:`<@!${player.id}>`) + `, it's your turn.`;
    if (timeRemaining > 0) {
      message += `You have ${timeRemaining} seconds.. `;
    }
    if (player.isBot){
      
      return message;
     }
    let row = new MessageActionRow();
    for (let action of availableActions) {
      let button = new MessageButton()
      .setStyle((action != 'fold') ? 'red':'grey')
      //.setLabel(`(${action.charAt(0).toUpperCase()})${action.slice(1)}\t`)
      .setLabel(`${action.charAt(0).toUpperCase()}${action.slice(1)}\t`)
      .setID(`${action}`);

      row.addComponents(button);
    }

    

    
    return { content: message, components: [row] };
  }
  // static buildActionMessage(player, availableActions, timeRemaining) {
  //   let message = (player.isBot?`${player.name}`:`<@!${player.id}>`) + `, it's your turn. Respond with:\n`;

  //   for (let action of availableActions) {
  //     let button_allin = new MessageButton()
  //     .setStyle('red')
  //     .setLabel('Allin')
  //     .setID('allin');

  //     let row1 = new MessageActionRow()
  //     .addComponents(button_raise, button_check, button_fold);
  //     message += `*(${action.charAt(0).toUpperCase()})${action.slice(1)}*\t`;
  //   }
    
  //   if (timeRemaining > 0) {
  //     message += `\nin the next ${timeRemaining} seconds.`;
  //   }
    
  //   return message;
  // }

  // Private: Given an array of actions taken previously in the hand, returns
  // an array of available actions.
  //
  // player - The player who is acting
  // previousActions - A map of players to their most recent action
  //
  // Returns an array of strings
  static getAvailableActions(player, previousActions) {
    let actions = _.values(previousActions);
    let betActions = _.filter(actions, a => a.name === 'bet' || a.name === 'raise');
    let hasBet = betActions.length > 0;

    let availableActions = [];

    if (player.hasOption) {
      availableActions.push('check');
      availableActions.push('raise');
    } else if (hasBet) {
      availableActions.push('call');
      availableActions.push('raise');
    } else {
      availableActions.push('check');
      availableActions.push('bet');
    }

    // Prevent players from raising when they don't have enough chips.
    let raiseIndex = availableActions.indexOf('raise');
    if (raiseIndex > -1) {
      let previousWager = player.lastAction ? player.lastAction.amount : 0;
      let availableChips = player.chips + previousWager;
      
      if (_.max(betActions, a => a.amount).amount >= availableChips) {
        availableActions.splice(raiseIndex, 1);
      }
    }

    availableActions.push('fold');
    return availableActions;
  }

  // Private: Parse player input into a valid action.
  //
  // text - The text that the player entered
  // availableActions - An array of the actions available to this player
  // player - player object (only needed for handling allin case)
  //
  // Returns an object representing the action, with keys for the name and
  // bet amount, or null if the input was invalid.
  static actionFromClick(text, availableActions, player = null) {
    if (!text) return null;

    let input = text.trim().toLowerCase().split(/\s+/);
    if (!input[0]) return null;

    let name = '';
    let amount = 0;

    switch (input[0]) {
    case 'c':
      name = availableActions[0];
      break;
    case 'call':
      name = 'call';
      break;
    case 'check':
      name = 'check';
      break;
    case 'f':
    case 'fold':
      name = 'fold';
      break;
    case 'b':
    case 'bet':
      name = 'bet';
      amount = input[1] ? parseInt(input[1]) : NaN;
      break;
    case 'r':
    case 'raise':
      name = 'raise';
      amount = input[1] ? parseInt(input[1]) : NaN;
      break;
    case 'allin':
      name = availableActions[1];
      //TODO: this isn't quite right if you're the blinds and you go allin pre-flop 
      amount = player.chips;
      break;
    default:
      return null;
    }
  }
  
  static actionFromMessage(text, availableActions, player = null) {
    if (!text) return null;

    let input = text.trim().toLowerCase().split(/\s+/);
    if (!input[0]) return null;

    let name = '';
    let amount = 0;

    switch (input[0]) {
    case 'c':
      name = availableActions[0];
      break;
    case 'call':
      name = 'call';
      break;
    case 'check':
      name = 'check';
      break;
    case 'f':
    case 'fold':
      name = 'fold';
      break;
    case 'b':
    case 'bet':
      name = 'bet';
      amount = input[1] ? parseInt(input[1]) : NaN;
      break;
    case 'r':
    case 'raise':
      name = 'raise';
      amount = input[1] ? parseInt(input[1]) : NaN;
      break;
    case 'allin':
      name = availableActions[1];
      //TODO: this isn't quite right if you're the blinds and you go allin pre-flop 
      amount = player.chips;
      break;
    default:
      return null;
    }

    // NB: Unavailable actions are always invalid.
    return availableActions.indexOf(name) > -1 ?
      { name: name, amount: amount } :
      null;
  }
}

module.exports = PlayerInteraction;
