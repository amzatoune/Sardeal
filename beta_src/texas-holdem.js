const rx = require('rx');
const _ = require('underscore-plus');
const MessageAttachment = require('discord.js');
const Deck = require('./deck');
const PotManager = require('./pot-manager');
const PlayerOrder = require('./player-order');
const PlayerStatus = require('./player-status');
const PlayerInteraction = require('./player-interaction');
const ImageHelpers = require('./image-helpers');

class TexasHoldem {
  // Public: Creates a new game instance.
  //
  // client - An instance of the Discord client
  // messages - An {Observable} representing messages posted to the channel
  // channel - The channel where the game will be played
  // players - The players participating in the game
  // scheduler - (Optional) The scheduler to use for timing events
  constructor(client, messages, clicks, channel, players, gameConfig, scheduler = rx.Scheduler.timeout) {
    this.discordClient = client;
    this.messages = messages;
    this.clicks = clicks;
    this.channel = channel;
    this.players = players;
    this.scheduler = scheduler;
    this.status = undefined;
    this.action_posted = undefined;
    this.board_message = undefined;

    // copy gameconfig to allow each game to be distinct
    this.gameConfig = Object.assign( {}, gameConfig);
    
    this.smallBlind = this.gameConfig.smallblind;
    this.bigBlind = this.smallBlind * 2;
    this.potManager = new PotManager(this.channel, players, this.smallBlind);
    this.gameEnded = new rx.Subject();


    // Each player starts with initial stash
    for (let player of this.players) {
      player.chips = this.gameConfig.initialstash;
    }
  }

  // Public: Starts a new game.
  //
  // playerDms - A hash mapping player ID to their DM channel, used to inform
  //             players of their pocket cards.
  // dealerButton - (Optional) The initial index of the dealer button, or null
  //                to have it randomly assigned
  // timeBetweenHands - (Optional) The time, in milliseconds, to pause between
  //                    the end of one hand and the start of another
  //
  // Returns an {Observable} that signals completion of the game
  start(playerDms, dealerButton = null, timeBetweenHands = 5000) {
    this.isRunning = true;
    this.playerDms = playerDms;
    this.dealerButton = dealerButton === null ?
      Math.floor(Math.random() * this.players.length) :
      dealerButton;

    rx.Observable.return(true)
      .flatMap(() => this.playHand())
      .subscribe();

    return this.gameEnded;
  }

  // Public: Ends the current game immediately.
  //
  // Returns nothing
  quit(winner) {
    if (winner) {
      this.channel.send(`Congratulations ${winner.name}, you've won!`);
    }

    this.gameEnded.onNext(winner);
    this.gameEnded.onCompleted();

    this.isRunning = false;
  }

  // Public: Get all players still in the current hand.
  //
  // Returns an array of players
  getPlayersInHand() {
    return _.filter(this.players, player => player.isInHand);
  }

  // Private: Plays a single hand of hold'em. The sequence goes like this:
  // 1. Clear the board and player hands
  // 2. Shuffle the deck and give players their cards
  // 3. Do a pre-flop betting round
  // 4. Deal the flop and do a betting round
  // 5. Deal the turn and do a betting round
  // 6. Deal the river and do a final betting round
  // 7. Decide a winner and send chips their way
  //
  // Returns an {Observable} signaling the completion of the hand
  playHand() {
    this.board = [];
    this.playerHands = {};

    this.initializeHand();
    this.deck = new Deck();
    this.deck.shuffle();
    this.dealPlayerCards();

    let handEnded = new rx.Subject();

    this.doBettingRound('preflop').subscribe(result => {
      if (result.isHandComplete) {
        this.potManager.endHand(this.discordClient, result);
        this.onHandEnded(handEnded);
      } else {
        this.flop(handEnded);
      }
    });

    return handEnded;
  }

  // Private: increase blinds
  // TODO: allow the increase to be specified
  // Returns nothing
  increaseBlinds() {
    this.smallBlind = this.smallBlind * 2;
    this.bigBlind = this.smallBlind * 2;
  }

  // Private: Adds players to the hand if they have enough chips and determines
  // small blind and big blind indices.
  //
  // Returns nothing
  initializeHand() {
    for (let player of this.players) {
      player.isInRound = player.isInHand = player.chips > 0;
      player.isAllIn = false;
      player.isBettor = false;
    }

    let participants = _.filter(this.players, p => p.isInHand);
    this.potManager.createPot(participants);

    this.smallBlindIdx = PlayerOrder.getNextPlayerIndex(this.dealerButton, this.players);
    this.bigBlindIdx = PlayerOrder.getNextPlayerIndex(this.smallBlindIdx, this.players);
  }

  // Private: Handles the logic for a round of betting.
  //
  // round - The name of the betting round, e.g., 'preflop', 'flop', 'turn'
  //
  // Returns an {Observable} signaling the completion of the round
  doBettingRound(round) {
    // If there aren't at least two players with chips to bet, move along to a
    // showdown.
    let playersRemaining = this.getPlayersInHand();
    let playersWhoCanBet = _.filter(playersRemaining, p => !p.isAllIn);
    if (playersWhoCanBet.length < 2) {
      let result = { isHandComplete: false };
      return rx.Observable.return(result);
    }

    this.orderedPlayers = PlayerOrder.determine(this.players, this.dealerButton, round);
    let previousActions = {};
    let roundEnded = new rx.Subject();

    this.resetPlayersForBetting(round, previousActions);

    // Take the players remaining in the hand, in order, and poll each for
    // an action. This cycle will be repeated until the round is ended, which
    // can occur after any player action.
    let queryPlayers = rx.Observable.fromArray(this.orderedPlayers)
      .where((player) => player.isInHand && !player.isAllIn)
      .concatMap((player) => this.deferredActionForPlayer(player, previousActions, roundEnded))
      .repeat()
      .takeUntil(roundEnded)
      .publish();

    queryPlayers.connect();
    return roundEnded.do(() => this.potManager.endBettingRound());
  }

  // Private: Resets all player state from the previous round. If this is the
  // preflop, do some additional initialization.
  //
  // round - The name of the betting round
  // previousActions - A map of players to their most recent action
  //
  // Returns nothing
  resetPlayersForBetting(round, previousActions) {
    for (let player of this.players) {
      player.isInRound = player.chips > 0;
      player.lastAction = null;
      player.isBettor = false;
      player.hasOption = false;
    }

    this.potManager.startBettingRound();

    if (round === 'preflop') {
      this.postBlinds(previousActions);
    }
  }

  // Private: Posts blinds for a betting round.
  //
  // previousActions - A map of players to their most recent action
  //
  // Returns nothing
  postBlinds(previousActions) {
    let sbPlayer = this.players[this.smallBlindIdx];
    let bbPlayer = this.players[this.bigBlindIdx];

    let sbAction = { name: 'bet', amount: this.smallBlind };
    let bbAction = { name: 'bet', amount: this.bigBlind };

    // Treat posting blinds as a legitimate bet action.
    this.onPlayerAction(sbPlayer, sbAction, previousActions, null, 'small blind');
    this.onPlayerAction(bbPlayer, bbAction, previousActions, null, 'big blind');

    // So, in the preflop round we want to treat the big blind as the
    // bettor. Because the bet was implicit, that player also has an option,
    // i.e., they will be the last to act (as long as they have chips).
    bbPlayer.hasOption = bbPlayer.chips > 0;
  }

  // Private: Displays player position and who's next to act, pauses briefly,
  // then polls the acting player for an action. We use `defer` to ensure the
  // sequence doesn't continue until the player has responded.
  //
  // player - The player being polled
  // previousActions - A map of players to their most recent action
  // roundEnded - A {Subject} used to end the betting round
  // timeToPause - (Optional) The time to wait before polling, in ms
  //
  // Returns an {Observable} containing the player's action
  deferredActionForPlayer(player, previousActions, roundEnded, timeToPause = 100) {
    return rx.Observable.defer(() => {
      //console.log(this.status);
      // Display player position and who's next to act before polling.
      // console.log(this.status);
      PlayerStatus.displayHandStatus(this.status, this.channel,
        this.players, this.board, player,
        this.potManager, this.dealerButton,
        this.bigBlindIdx, this.smallBlindIdx,
        this.tableFormatter).then(m=> {this.status = m;});


      return rx.Observable.timer(timeToPause, this.scheduler).flatMap(() => {
        this.actingPlayer = player;

        return PlayerInteraction.getActionForPlayer(this.discordClient, this.messages, this.clicks, this.channel,
          player, previousActions, this.scheduler, this.timeout)
          .do(action => this.onPlayerAction(player, action, previousActions, roundEnded));
      });
    });
  }

  // Private: Occurs immediately after a player action is received. First,
  // validate the action and possibly modify the amount wagered. Then see if
  // the action caused the betting round to end.
  //
  // player - The player who acted
  // action - The action the player took
  // previousActions - A map of players to their most recent action
  // roundEnded - A {Subject} used to end the betting round
  // postingBlind - (Optional) String describing the blind, or empty
  //
  // Returns nothing
  onPlayerAction(player, action, previousActions, roundEnded, postingBlind = '') {
    this.potManager.updatePotForAction(player, action);
    this.postActionToChannel(player, action, postingBlind).then(m=>{this.action_posted = m;});

    // Now that the action has been validated, save it for future reference.
    player.lastAction = action;
    previousActions[player.id] = action;

    // All of these methods assume that the action is valid.
    switch (action.name) {
      case 'fold':
        this.onPlayerFolded(player, roundEnded);
        break;
      case 'check':
        this.onPlayerChecked(player, roundEnded);
        break;
      case 'call':
        this.onPlayerCalled(player, roundEnded);
        break;
      case 'bet':
      case 'raise':
        this.onPlayerBet(player, roundEnded);
        break;
    }
  }

  // Private: If everyone folded out, declare a winner. Otherwise see if this
  // was the last player to act and move to the next round.
  //
  // player - The player who folded
  // roundEnded - A {Subject} used to end the betting round
  //
  // Returns nothing
  onPlayerFolded(player, roundEnded) {
    // See if this was the last player to act before we fold them out,
    // otherwise they won't be in the list of remaining players.
    let everyoneActed = PlayerOrder.isLastToAct(player, this.orderedPlayers);

    player.isInHand = false;
    let playersRemaining = this.getPlayersInHand();

    if (playersRemaining.length === 1) {
      let result = {
        isHandComplete: true,
        winners: [playersRemaining[0]],
        isSplitPot: false
      };
      roundEnded.onNext(result);
    } else if (everyoneActed) {
      let result = { isHandComplete: false, lastPlayer: player };
      roundEnded.onNext(result);
    }
  }

  // Private: If everyone checked, move to the next round.
  //
  // player - The player who checked
  // previousActions - A map of players to their most recent action
  // roundEnded - A {Subject} used to end the betting round
  //
  // Returns nothing
  onPlayerChecked(player, roundEnded) {
    let everyoneChecked = this.everyPlayerTookAction(['check', 'call'],
      p => p.isInHand && !p.isAllIn);
    let everyoneHadATurn = PlayerOrder.isLastToAct(player, this.orderedPlayers);

    if (everyoneChecked && everyoneHadATurn) {
      let result = { isHandComplete: false, lastPlayer: player };
      roundEnded.onNext(result);
    }
  }

  // Private: If everyone left in the hand has called and we're back to the
  // original bettor, move to the next round.
  //
  // player - The player who called
  // roundEnded - A {Subject} used to end the betting round
  //
  // Returns nothing
  onPlayerCalled(player, roundEnded) {
    let everyoneCalled = this.everyPlayerTookAction(['call'],
      p => p.isInHand && !p.isAllIn && !p.isBettor);
    let everyoneHadATurn = PlayerOrder.isLastToAct(player, this.orderedPlayers);

    if (everyoneCalled && everyoneHadATurn) {
      let result = { isHandComplete: false, lastPlayer: player };
      roundEnded.onNext(result);
    }

    if (player.chips === 0) {
      player.isAllIn = true;
    }
  }

  // Private: When a player bets, assign them as the current bettor. The
  // betting round will cycle through all players up to the bettor.
  //
  // player - The player who bet or raised
  //
  // Returns nothing
  onPlayerBet(player, roundEnded) {
    let currentBettor = _.find(this.players, p => p.isBettor);
    if (currentBettor) {
      currentBettor.isBettor = false;
      currentBettor.hasOption = false;
    }

    player.isBettor = true;
    if (player.chips === 0) {
      player.isAllIn = true;
    }

    let playersWhoCanCall = _.filter(this.players,
      p => p.isInHand && !p.isBettor && p.chips > 0);
    if (playersWhoCanCall.length === 0) {
      let result = { isHandComplete: false, lastPlayer: player };
      roundEnded.onNext(result);
    }
  }

  // Private: Displays the flop cards and does a round of betting. If the
  // betting round results in a winner, end the hand prematurely. Otherwise,
  // progress to the turn.
  //
  // handEnded - A {Subject} that is used to end the hand
  //
  // Returns nothing
  flop(handEnded) {
    this.deck.drawCard(); // Burn one
    let flop = [this.deck.drawCard(), this.deck.drawCard(), this.deck.drawCard()];
    this.board = flop;

    this.postBoard('flop').subscribe(() => {
      this.doBettingRound('flop').subscribe(result => {
        if (result.isHandComplete) {
          this.potManager.endHand(result);
          this.onHandEnded(handEnded);
        } else {
          this.turn(handEnded);
        }
      });
    });
  }

  // Private: Displays the turn card and does an additional round of betting.
  //
  // handEnded - A {Subject} that is used to end the hand
  //
  // Returns nothing
  turn(handEnded) {
    this.deck.drawCard(); // Burn one
    let turn = this.deck.drawCard();
    this.board.push(turn);

    this.postBoard('turn').subscribe(() => {
      this.doBettingRound('turn').subscribe(result => {
        if (result.isHandComplete) {
          this.potManager.endHand(result);
          this.onHandEnded(handEnded);
        } else {
          this.river(handEnded);
        }
      });
    });
  }

  // Private: Displays the river card and does a final round of betting.
  //
  // handEnded - A {Subject} that is used to end the hand
  //
  // Returns nothing
  river(handEnded) {
    this.deck.drawCard(); // Burn one
    let river = this.deck.drawCard();
    this.board.push(river);

    this.postBoard('river').subscribe(() => {
      this.doBettingRound('river').subscribe(result => {
        // Still no winner? Time for a showdown.
        if (!result.isHandComplete) {
          // console.log('Showdown Last', result.lastPlayer);
          //console.log('Showdown Order', PlayerOrder.determine(this.players, this.dealerButton, 'showdown'));
          //TODO if all in show end 
          //TODO if first after last player action, show hand
          let playersRemaining = _.filter(this.players, p => p.isInHand && p.isInRound);
          let currentIndex = playersRemaining.indexOf(result.lastPlayer);
          //let nextIndex = PlayerOrder.getNextPlayerIndex(currentIndex, playersRemaining);
          let showdownOrder = PlayerOrder.determine(this.players, currentIndex, 'showdown');

          this.potManager.endHandWithShowdown(this.discordClient, this.playerHands, this.board, showdownOrder);
        } else {
          this.potManager.endHand(this.discordClient, result);
        }
        this.onHandEnded(handEnded);
      });
    });
  }

  // Private: Move the dealer button and see if the game has ended.
  //
  // handEnded - A {Subject} that is used to end the hand
  //
  // Returns nothing
  onHandEnded(handEnded) {
    this.dealerButton = (this.dealerButton + 1) % this.players.length;

    handEnded.onNext(true);
    handEnded.onCompleted();

    this.checkForGameWinner();
  }

  // Private: If there is only one player with chips left, we've got a winner.
  //
  // Returns nothing
  checkForGameWinner() {
    let playersWithChips = _.filter(this.players, p => p.chips > 0);
    if (playersWithChips.length === 1) {
      let winner = playersWithChips[0];
      this.quit(winner);
    }
  }

  // Private: Deals hole cards to each player in the game. To communicate this
  // to the players, we send them a DM with the text description of the cards.
  // We can't post in channel for obvious reasons.
  //
  // Returns nothing
  dealPlayerCards() {
    this.orderedPlayers = PlayerOrder.determine(this.getPlayersInHand(), this.dealerButton, 'deal');

    for (let player of this.orderedPlayers) {
      let card = this.deck.drawCard();
      this.playerHands[player.id] = [card];
    }

    for (let player of this.orderedPlayers) {
      let card = this.deck.drawCard();
      this.playerHands[player.id].push(card);

      if (!player.isBot) {
        this.sendPlayerHand(player).subscribe(() => {
          console.log(`Sent hand to player ${player.name}`);
        });
      } else {
        player.holeCards = this.playerHands[player.id];
      }
    }
  }


  // Private: send a DM to the player with their cards
  // returns: Observable

  sendPlayerHand(player) {
    let dm = this.playerDms[player.id];

    if (this.gameConfig.show_card_images==1) {
      return ImageHelpers.createPlayerHandImage(this.playerHands[player.id])
      .timeout(5000)
      .flatMap(buffer => {
        // let message_attachment = new MessageAttachment(buffer, 'hand.png');
        // dm.send(`Your hand is:`, message_attachment);
        dm.send(`Your hand is:`, { files: [buffer] });
        // NB: Since we don't have a callback for the message arriving, we're
        // just going to wait a second before continuing.
        return rx.Observable.timer(1000, this.scheduler);
      })
      .take(1)
      .catch((error) => {
        console.error(error);
        dm.send(`Your hand is: ${this.playerHands[player.id]}`);
        return rx.Observable.timer(1000, this.scheduler);
      });
    }
    else {
      dm.send(`Your hand is: ${this.playerHands[player.id]}`);
      return rx.Observable.timer(1000, this.scheduler);
    }
  }


  // Private: Creates an image of the cards on board and posts it to the
  // channel using `message.attachments`.
  //
  // round - The name of the round
  //
  // Returns an {Observable} indicating completion
  postBoard(round) {
    if (this.gameConfig.show_card_images==1) {
      return ImageHelpers.createBoardImage(this.board)
      .timeout(5000)
      .flatMap(buffer => {
        // let board_attachment = new MessageAttachment(buffer, "board.png"); //`Board${round}.png`
        // this.channel.send(`Dealing the ${round}:`, board_attachment);
        if (this.board_message) {
          this.board_message.delete().then(()=>{this.channel.send(`Dealing the ${round}:`, { files: [buffer] }).then(m=> {this.board_message = m;});});
          }
        else{
          this.channel.send(`Dealing the ${round}:`, { files: [buffer] }).then(m=> {this.board_message = m;});
        }
        // message.attachments = [{
        //   title: `Dealing the ${round}:`,
        //   fallback: this.board.toString(),
        //   text: this.board.toString(),
        //   color: 'good',
        //   image_url: url,
        //   channel: this.channel
        // }];

        // NB: Since we don't have a callback for the message arriving, we're
        // just going to wait a second before continuing.
        return rx.Observable.timer(1000, this.scheduler);
      })
      .take(1)
      .catch(() => {
        console.error('Creating board image timed out');
        if (this.board_message) {
          this.board_message.delete({ timeout: 5 });
          }
        let message = `Dealing the ${round}:\n${this.board.toString()}`;
        this.channel.send(message);

        return rx.Observable.timer(1000, this.scheduler);
      });
    }
    else {
      if (this.board_message) {
        this.board_message.delete({ timeout: 5 });
        }
      let message = `Dealing the ${round}:\n${this.board.toString()}`;
      this.channel.send(message);

      return rx.Observable.timer(1000, this.scheduler);
    }
  }

  // Private: Posts a message to the channel describing a player's action.
  //
  // player - The acting player
  // action - The action that they took
  // postingBlind - (Optional) String describing the blind, or empty
  //
  // Returns nothing
  postActionToChannel(player, action, postingBlind = '') {
    let message = postingBlind === '' ?
      `**${player.name} ${action.name}s**` :
      `**${player.name} posts ${postingBlind} of**`;

    if (action.name === 'bet')
      message += ` $${action.amount}.`;
    else if (action.name === 'raise')
      message += ` to $${action.amount}.`;
    else
      message += '.';

    let get_message = undefined;
    if (this.action_posted) {
        get_message = this.action_posted.edit(message);
      }
    else {
        get_message = this.channel.send(message);
      }
    return get_message;
  }

  // Private: Checks if all player actions adhered to some condition.
  //
  // actions - An array of strings describing the desired actions
  // playerPredicate - A predicate to filter players on
  //
  // Returns true if every player that meets the predicate took one of the
  // desired actions
  everyPlayerTookAction(actions, playerPredicate) {
    let playersRemaining = _.filter(this.players, playerPredicate);
    return _.every(playersRemaining, p => p.lastAction !== null &&
      actions.indexOf(p.lastAction.name) > -1);
  }
}

module.exports = TexasHoldem;
