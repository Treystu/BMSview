<![CDATA[
const { getCollection } = require('./utils/mongodb.cjs');
const { v4: uuidv4 } = require("uuid");

exports.handler = async (event, context) => {
  const { storyId, caption, timestamp } = event.queryStringParameters;
  const image = JSON.parse(event.body).image;

  // In a real application, you would add authentication and authorization here.

  const photo = {
    id: uuidv4(),
    storyId,
    caption,
    timestamp,
    url: `/.netlify/blobs/story-photos/${photo.id}.png`, // This is a placeholder
  };

  // In a real application, you would upload the image to a blob store.
  // For now, we'll just log it.

  const storiesCollection = await getCollection('stories');
  await storiesCollection.updateOne(
    { id: storyId },
    { $push: { photos: photo } }
  );

  return {
    statusCode: 200,
    body: JSON.stringify(photo),
  };
};
]]>