// dependencies
var async     = require('async')
    , AWS     = require('aws-sdk')
    , gm      = require('gm').subClass({ imageMagick: true }) // Enable ImageMagick integration.
    , util    = require('util')
    , request = require('request')
    , config  = require('config');

// constants
var MAX_WIDTH  = 100
  , MAX_HEIGHT = 100;

// get reference to S3 client 
var s3 = new AWS.S3();
 
exports.handler = function(event, context) {
  // Read options from the event.
  console.log("Reading options from event:\n", util.inspect(event, {depth: 5}));
    
  var srcBucket = event.Records[0].s3.bucket.name;
  var srcKey    = event.Records[0].s3.object.key;

  if(!srcKey || srcKey === "") {
      console.log('Source key is invalid');
    return;
  }

  // if [parentId]/thumbs/fileId-name then image is a thumb
  // if [parentId]/fileId-name then uploaded image

  let pSrcKey = srcKey.substring(0, srcKey.lastIndexOf('/')+1);

  // prevent recursion i.e. saving thumb might trigger another event add infinitum
  if(pSrcKey.indexOf('/thumbs/') > 0 || pSrcKey.indexOf('thumbs') > 0) { // check if thumb
    console.log('Image is already a thumbnail.');
    return;
  }

  var dstBucket = srcBucket; // thumbs are stored in the same bucket under thumbs dir

  let a = srcKey.split('/');
  let parentId = a[0]; // parentId
  let fileIdName = encodeURIComponent(a[1]); // fileId-name
  let dstKey    = parentId + '/thumbs/' + fileIdName;
  let file = {'name': fileIdName};

  // Infer the image type.
  var typeMatch = srcKey.match(/\.([^.]*)$/);
  if (!typeMatch) {
    console.error('unable to infer image type for key ' + srcKey);
    return;
  }

  // how to add arguments to choose image type

  var validImageTypes = ['png', 'jpg', 'jpeg', 'gif'];
  var imageType = typeMatch[1];
  if (validImageTypes.indexOf(imageType.toLowerCase()) < 0) {
    console.log('skipping non-image ' + srcKey);
    return;
  }

  // Download the image from S3, transform, and upload to a different S3 bucket.
  async.waterfall([
    function download(next) {
      // Download the image from S3 into a buffer.
      s3.getObject({
        Bucket : srcBucket,
        Key    : srcKey
      }, next);
    },
    function tranform(response, next) {
      gm(response.Body).size(function(err, size) {
        // Infer the scaling factor to avoid stretching the image unnaturally.
        var scalingFactor = Math.min(
          MAX_WIDTH / size.width,
          MAX_HEIGHT / size.height
        );
        var width  = scalingFactor * size.width;
        var height = scalingFactor * size.height;

        // Transform the image buffer in memory.
        this.resize(width, height)
          .toBuffer(imageType, function(err, buffer) {
            if (err) {
              next(err);
            } else {

                // get the filesize of the thumb
                gm(buffer).filesize(function (err, filesize) {
                    file.size = parseInt(filesize, 10);
                });

              next(null, response.ContentType, buffer);
            }
          });
      });
    },
      // here get size function
    function upload(contentType, data, next) {
      // Stream the transformed image to a different S3 bucket.
      file.contentType = contentType;
      file.size = 0;

      s3.putObject({
        Bucket      : dstBucket,
        Key         : dstKey,
        Body        : data,
        ContentType : contentType
      }, next);
    }],
    function (err) {
      if (err) {
        console.error(
          'Unable to resize ' + srcBucket + '/' + srcKey +
          ' and upload to ' + dstBucket + '/' + dstKey +
          ' due to an error: ' + err
        );
        context.done();
      } else {
        console.log(
          'Successfully resized ' + srcBucket + '/' + srcKey +
          ' and uploaded to ' + dstBucket + '/' + dstKey
        );

        console.log('FILE: ', file);

        // hash-fileId.ext
        var fileMatch = srcKey.match(/\-([^.]*)\./);

        if (!fileMatch) {
          context.done();
        } else {
          var fileId = fileMatch[1];

          var bucketConfig = config.buckets[srcBucket];

          // Change url so it points to api okcomply
          // method should add thumb information to copies array in file document

          request.post(bucketConfig.host + '/api/filecopy/add', {
            form : {
              bucket : bucketConfig.bucket,
              secret : bucketConfig.secret,
              fileId: fileId,
              file: file,
              key: dstKey

            }
          }, function(err, response, body) {
            err && console.log('could not make request back: ' + err);
            context.done();
          });
        }
      }
    }
  );
};
