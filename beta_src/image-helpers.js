const fs = require('fs');
const rx = require('rx');
const jimp = require('jimp');
const promisify = require('promisify-node');
const tmp = require('tmp');


const getBuffer = async function(outputFile) {
  //let buffer_out = undefined;
  let img = await jimp.read(outputFile);
  let buffer_out = await img.getBufferAsync(jimp.MIME_PNG);
return buffer_out;
};

class ImageHelpers {

  // Public: Creates an image of the board from the given cards using the
  // jimp, then writes the result to a file and uploads it to `imgur`.
  //
  // imageFiles - An array of three image files
  // outputFile - The file where the result will be saved
  // upload - (Optional) Defaults to `imgur`, but can be overridden for testing
  //
  // Returns an {Observable} that will `onNext` with the URL of the combined
  // image, or `onError` if anything goes wrong
  


  static createBoardImage(cards, upload = getBuffer) {
    
    let subj = new rx.AsyncSubject();
    let imageFiles = cards.map(c => `resources/${c.toAsciiString()}.png`);
    let back = `resources/back_red.png`;
    // create a tmp dir that will auto-cleanup all files plus itself
    // on node process exit
    let output_dir = tmp.dirSync({unsafeCleanup:true});
    tmp.setGracefulCleanup();
    //class output_direc{constructor(name){this.name=name;}};
    //let output_dir = new output_direc(`resources/tmp`);
    //let output_dir.name = `resources/tmp`;
    //console.log('output_dir: ', output_dir.name);

    let makeImage = null;
    let imagePath = null;
    switch (cards.length) {
      case 2:
        imagePath = output_dir.name+'/hand.png';
        makeImage = ImageHelpers.combineTwo(imageFiles, imagePath);
        /* .then(outputFile => {
          console.log('Hand rendered');
        }); */

        break;
      case 3:
        imagePath = output_dir.name+'/flop.png';
        // makeImage = ImageHelpers.combineThree(imageFiles, imagePath);

        makeImage = ImageHelpers.combineThree(
          imageFiles,
          output_dir.name+'/flop_flop.png',
        ).then(outputFile => {
          //console.log('Turn part 1 rendered. Turn part 2 now');
          return ImageHelpers.combineThree(
            [outputFile, back, back],
            imagePath);
            /* .then(outputFile => {
              console.log('Turn rendered');
            })} */
          });
        /* .then(outputFile => {
          console.log('Flop rendered');
        }); */

        break;
      case 4:
        imagePath =  output_dir.name+'/turn.png';
        makeImage = ImageHelpers.combineThree(
          imageFiles,
          output_dir.name+'/turn_flop.png',
        ).then(outputFile => {
          //console.log('Turn part 1 rendered. Turn part 2 now');
          return ImageHelpers.combineThree(
            [outputFile, imageFiles[3], back],
            imagePath);
            /* .then(outputFile => {
              console.log('Turn rendered');
            })} */
          });

        break;
      case 5:
        imagePath = output_dir.name+'/river.png';
        makeImage = ImageHelpers.combineThree(
          imageFiles,
          output_dir.name+'/river_flop.png',
        ).then(outputFile => {
          //console.log('River part 1 done. River part 2 now');
          return ImageHelpers.combineThree(
            [outputFile, imageFiles[3], imageFiles[4]],
            imagePath);
            /* .then(outputFile => {
              console.log('River rendered');
            })} */
          });
        
        break;
      default:
        throw new Error(
          `Attempted to make board image for ${cards.length} cards.`,
        );
    }

    makeImage
      .then(outputFile => {
        return upload(imagePath);
      })
      .then(result => {
        //subj.onNext(result.getBuffer(jimp.MIME_PNG, (err, buffer) => {console.log(buffer); return buffer;}));
	      subj.onNext(result);
        subj.onCompleted();
      })
      .catch(err => {
        subj.onError(err);
      });

    return subj;
  }

  // Convenience wrapper for creating a playerHand image
  static createPlayerHandImage(cards, upload = getBuffer) {
    return this.createBoardImage(cards, upload);
  }
  
  // Private: Combines two image files into a single row
  //
  // imageFiles - An array of two image files
  // outputFile - The file where the result will be saved
  //
  // Returns a {Promise} of the resulting file
  static combineTwo(imageFiles, outputFile) {
    let images = [];

    return jimp
      .read(imageFiles[0])
      .then(firstImage => {
        images.push(firstImage);
        return jimp.read(imageFiles[1]);
      })
      .then(secondImage => {
        images.push(secondImage);
        return new jimp(
          images[0].bitmap.width + images[1].bitmap.width,
          images[0].bitmap.height);
      })
      .then(destImage => { 
          destImage.composite(images[0], 0, 0);
          destImage.composite(images[1], images[0].bitmap.width, 0);
          return destImage.writeAsync(outputFile)
            .then(() => { 
              //console.log(`Output written ${outputFile}`)
              return outputFile;
            });
      });
      //.catch(err => console.error("combineTwo failed with:\n%s", err));
  }

  // Private: Combines three images files into a single row, using the
  // `combineTwo` sequentially
  //
  // imageFiles - An array of three image files
  // outputFile - The file where the result will be saved
  //
  // Returns a {Promise} of the resulting file
  static combineThree(imageFiles, outputFile) {
    let tempfile = outputFile+"_first.png";
    return ImageHelpers.combineTwo(imageFiles.slice(0, 2), tempfile)
      .then(() => { return ImageHelpers.combineTwo([tempfile, imageFiles[2]], outputFile)})
      .catch(err => console.error("combineThree failed with:\n%s", err));
  }
}

module.exports = ImageHelpers;
