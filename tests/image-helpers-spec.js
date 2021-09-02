require('babel-register');
var rx = require('rx');
var jimp = require('jimp');
var assert = require('chai').assert;
var Card = require('../beta_src/card');
var ImageHelpers = require('../beta_src/image-helpers');

// NB: This will need to be updated if the set of card images changes.
var cardSize = {width: 250, height: 363};

// NB: We use this in place of imgur's `uploadFile` method, but we still need
// to match their API, which returns a {Promise}.

var mockUpload = async function(outputFile) {
  //let buffer_out = undefined;
  let img = await jimp.read(outputFile);
  let buffer_out = await img.getBufferAsync(jimp.MIME_PNG);
return buffer_out;
};


mockUpload("resources/3c.png").then(function(result) { console.log(result);} );



describe('ImageHelpers', function() {
  describe('the create player hand', function() {
    it('should be able to create a two card hand image', function(done) {
      var kingDiamonds = new Card('K', 'Diamonds');
      var aceHearts = new Card('A', 'Hearts');

      let hand = ImageHelpers.createPlayerHandImage([kingDiamonds, aceHearts], mockUpload);
      hand.subscribe(output_file => {
        //console.log(`JIMPing Hand file ${output_file}`);
        jimp.read(output_file)
        .then(img => {
          assert(img.bitmap.width === cardSize.width * 2, "Hand image width check failed");
          assert(img.bitmap.height === cardSize.height, "Hand image height check failed");
          done();
        })
        .catch(err => {
          console.error("Hand jimp.read() failed with:\n%s", err);
          assert(false, "Hand failed to jimp.read");
        });
        },
        err => {
          console.error("Hand failed with:\n%s", err);
          assert(false, "Hand failed");
        }); 

    });
  });

  describe('the createBoardImage method', function() {
    it('should be able to create images for the flop, turn, and river', function(done) {
      var completions = new rx.Subject();
      
      var nineClubs = new Card('9', 'Clubs');
      var fourSpades = new Card('4', 'Spades');
      var kingDiamonds = new Card('K', 'Diamonds');
      var aceHearts = new Card('A', 'Hearts');
      var sevenSpades = new Card('7', 'Spades');

      let flop = ImageHelpers.createBoardImage(
        [nineClubs, fourSpades, kingDiamonds],
        mockUpload,
      );
      
      flop.subscribe(output_file => {
        //console.log('JIMPing Flop');
        jimp.read(output_file)
        .then(img => {
          assert(img.bitmap.width === cardSize.width * 3);
          assert(img.bitmap.height === cardSize.height);
          completions.onNext('Flop tested');
        })
        .catch(err => {
          console.error("Flop jimp.read() failed with:\n%s", err);
          //completions.onNext('Flop failed');
          assert(false, "Flop failed to jimp.read");
        });
        },
        err => {
          console.error("Flop failed with:\n%s", err);
          //completions.onNext('Flop failed');
          assert(false, "Flop failed");
        });


      let turn = ImageHelpers.createBoardImage(
        [nineClubs, fourSpades, kingDiamonds, aceHearts],
        mockUpload,
      );
      
      turn.subscribe(output_file => {
        //console.log('JIMPing Turn');
        jimp.read(output_file)
        .then(img => {
          //console.log('Testing Turn');
          assert(img.bitmap.width === cardSize.width * 4);
          assert(img.bitmap.height === cardSize.height);
          completions.onNext('Turn tested');
        })
        .catch(err => {
          console.error("Turn jimp.read() failed with:\n%s", err);
          //completions.onNext('Turn failed');
          assert(false, "Turn failed to jimp.read");
        });
      }, err => {
        console.error("Turn failed with:\n%s", err);
        //completions.onNext('Turn failed');
        assert(false, "Turn failed");
      });

      let river = ImageHelpers.createBoardImage(
        [nineClubs, fourSpades, kingDiamonds, aceHearts, sevenSpades],
        mockUpload,
      );
      
      river.subscribe(output_file => {
        //console.log('JIMPing River');
        jimp.read(output_file)
        .then(img => {
          //console.log('Testing River');
          assert(img.bitmap.width === cardSize.width * 5);
          assert(img.bitmap.height === cardSize.height);
          completions.onNext('River tested');
        })
        .catch(err => {
          console.error("River jimp.read() failed with:\n%s", err);
          //completions.onNext('River failed');
          assert(false, "River failed to jimp.read");
        });
      }, err => {
        console.error("River failed with:\n%s", err);
        //completions.onNext('River failed');
        assert(false, "River failed");
      });
      

      // wait for all three to finish before we are done.
      var count = 0;
      completions.subscribe(x => {
        //console.log(x);
        count++
        if (count == 3) {
          //console.log("Finished");
          flop.dispose();
          turn.dispose();
          river.dispose();
          done();
        }
      });
      
    });
  });
});
