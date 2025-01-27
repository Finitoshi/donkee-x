const express = require('express');
const axios = require('axios');
const { TwitterApi } = require('twitter-api-v2');
const rateLimit = require('express-rate-limit');
const { MongoClient } = require('mongodb');
const app = express();

// Initialize Twitter client for OAuth 2.0 (for both reading and writing operations)
const twitterClientOAuth2 = new TwitterApi(process.env.BEARER_TOKEN);

// Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2, // Limit each IP to 1 request per windowMs due to free tier limits
  message: "Too many requests from this IP, please try again later.",
  handler: (req, res, next, options) => {
    console.log(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(options.statusCode).send(options.message);
  }
});
app.use(limiter);

// Check for required environment variables
const requiredEnvVars = ['BEARER_TOKEN', 'GROK_API_KEY', 'MONGODB_URL', 'DONKEE_SECRET_KEY'];
requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    console.error(`Missing environment variable: ${envVar}`);
    process.exit(1);
  }
});

// MongoDB connection using environment variable
const url = process.env.MONGODB_URL;
const dbName = 'donkeeBot';
let db;

// Connect to MongoDB
MongoClient.connect(url, { useUnifiedTopology: true }, async function(err, client) {
  if (err) {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1); // Exit the process if MongoDB connection fails
  } else {
    console.log('Connected successfully to MongoDB server');
    db = client.db(dbName);
    try {
      await setupTweetCollection();
      await addSchemaValidation();
    } catch (setupError) {
      console.error('Error setting up MongoDB:', setupError);
      process.exit(1); // Exit if setup fails
    }
  }
});

// Function to setup the collection with appropriate indexes
async function setupTweetCollection() {
  if (!db) return;
  const collection = db.collection('tweets');
  
  try {
    await collection.createIndex({ "timestamp": 1 }, { background: true });
    await collection.createIndex({ "hashtags": 1 }, { background: true });
    await collection.createIndex({ "likes": -1, "retweets": -1 }, { background: true });
    console.log('Indexes created successfully for tweets collection');
  } catch (error) {
    console.error('Error creating indexes:', error);
    throw error;
  }
}

// Add schema validation to the tweets collection
async function addSchemaValidation() {
  if (!db) return;
  const collection = db.collection('tweets');
  
  const validationRules = {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["tweet_id", "text", "likes", "retweets", "timestamp"],
        properties: {
          tweet_id: { bsonType: "string" },
          text: { bsonType: "string" },
          likes: { bsonType: "int" },
          retweets: { bsonType: "int" },
          timestamp: { bsonType: "date" },
          hashtags: {
            bsonType: "array",
            items: { bsonType: "string" }
          }
        }
      }
    },
    validationLevel: "strict",
    validationAction: "error"
  };

  try {
    await db.command({ collMod: "tweets", ...validationRules });
    console.log('Validation rules applied to the tweets collection.');
  } catch (error) {
    console.error('Error applying validation rules:', error);
    throw error;
  }
}

/**
 * Store tweets in MongoDB with the new structure
 */
async function storeTweet(tweet) {
  if (!db) return Promise.reject(new Error('MongoDB not connected'));
  const collection = db.collection('tweets');
  
  const tweetData = {
    tweet_id: tweet.id,
    text: tweet.text,
    likes: tweet.public_metrics?.like_count || 0,
    retweets: tweet.public_metrics?.retweet_count || 0,
    timestamp: new Date(tweet.created_at),
    hashtags: tweet.entities?.hashtags?.map(h => h.tag) || []
  };

  try {
    await collection.insertOne(tweetData);
    console.log('Tweet stored in MongoDB:', tweet.id);
  } catch (error) {
    console.error('Error storing tweet:', error, 'Tweet data:', JSON.stringify(tweetData));
    throw error;
  }
}

/**
 * Search for tweets and store them in MongoDB, including from lists with rate limit handling
 */
async function searchAndStoreTweets() {
  try {
    const query = '#sol OR #solana OR #memecoins OR #memes OR #crypto OR #100x lang:en -is:retweet';
    const searchResult = await twitterClientOAuth2.v2.search(query, { max_results: 100 });

    if (searchResult.data && Array.isArray(searchResult.data)) {
      for (const tweet of searchResult.data) {
        await storeTweet(tweet);
      }
      console.log('Tweets from search query stored in MongoDB.');
    } else {
      console.log('No tweets found from search query');
    }

    // Fetch tweets from lists with rate limit handling
    const listIds = [
      '1587987762908651520', '1726621096902807989', '1777037601578287430', 
      '1747955009617006656', '1818599454951588008'
    ];
    // Note: With the free tier, you can only make 1 request every 15 minutes for each operation
    for (let listId of listIds) {
      try {
        const listTweets = await twitterClientOAuth2.v2.listTweets(listId, { max_results: 100 });

        if (listTweets.data && Array.isArray(listTweets.data)) {
          for (const tweet of listTweets.data) {
            await storeTweet(tweet);
          }
          console.log(`Tweets from list ${listId} stored in MongoDB.`);
        } else {
          console.log(`No tweets found from list ${listId}`);
        }
      } catch (listError) {
        console.error(`Error fetching tweets from list ${listId}:`, listError);
        // We do not implement retrying here because of the severe rate limits on the free tier
      }
    }
  } catch (error) {
    console.error('Error in searchAndStoreTweets:', error);
    throw error;
  }
}

/**
 * Generate a new tweet using Grok AI
 */
async function generateNewTweet() {
  const payload = {
    "messages": [
      {
        "role": "system",
        "content": "Here is a little bit about donkee character,Donkee is the only donkey on Solana. He is a combination of Pepe X donkey A highly intelligent donkey, that loves smoking weed, reading charts and trading meme coins."
      },
      {
        "role": "user",
        "content": "Yo, drop a tweet that'll make the degen fam laugh or think."
      }
    ],
    "model": "grok-2-latest",
    "stream": false,
    "temperature": 0.8
  };

  try {
    const response = await axios.post('https://api.x.ai/v1/chat/completions', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
      },
      timeout: 180000 // 3 minutes timeout for API calls
    });
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Error generating tweet with Grok:', error);
    throw error;
  }
}

/**
 * Find the highest engagement tweet from MongoDB
 */
async function findHighestEngagementTweet() {
  if (!db) return null;
  const collection = db.collection('tweets');
  try {
    return await collection.findOne({}, { sort: { likes: -1, retweets: -1 } });
  } catch (error) {
    console.error('Error finding highest engagement tweet:', error);
    throw error;
  }
}

/**
 * Use Grok AI to generate a comment
 */
async function generateCommentWithGrok(tweetText) {
  const payload = {
    "messages": [
      {
        "role": "system",
        "content": "You're DONKEE, the chillest, most stoned donkey around, deep into Solana memecoins and the whole degen life. Keep your tweets real, funny, and a bit chaotic - speak like you're at a festival, not a conference. Aim for the crowd that loves risky, meme-driven crypto plays but keep it light, no financial advice. Mix in slang, memes, and the latest crypto lingo like 'moon', 'rug pull', 'pump and dump', 'gas fees', 'yield farming', 'ape in', 'FOMO', and 'diamond hands'. But, dude, keep it unpredictable, like a real donkey on a wild night."
      },
      {
        "role": "user",
        "content": `Comment on this tweet: "${tweetText}". Keep it playful and avoid financial advice.`
      }
    ],
    "model": "grok-2-latest",
    "stream": false,
    "temperature": 0.8
  };

  try {
    const response = await axios.post('https://api.x.ai/v1/chat/completions', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
      },
      timeout: 180000 // 3 minutes timeout for API calls
    });
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Error generating comment with Grok:', error);
    throw error;
  }
}

/**
 * Generate and post comment on the best tweet from the last 8 hours
 */
async function generateAndPostComment() {
  try {
    const tweet = await findHighestEngagementTweet();
    if (tweet) {
      const comment = await generateCommentWithGrok(tweet.text);
      console.log('Generated Comment:', comment);

      // Post the reply using OAuth 2.0 - Note: We're limited to 17 posts per day
      await twitterClientOAuth2.v2.reply(comment, tweet.tweet_id);
      console.log('Reply sent successfully!');
    } else {
      console.log('No tweet found to comment on.');
    }
  } catch (error) {
    console.error('Error in comment generation or posting:', error);
    throw error;
  }
}

/**
 * Endpoint for initiating OAuth 2.0 Authorization
 * This is not used in the free tier but kept for reference
 */
app.get('/authorize', (req, res) => {
  // Since we're using Bearer token for free tier, this isn't needed for regular operations
  res.send('OAuth 2.0 authorization not required for free tier operations.');
});

// Endpoint for health check
app.get('/health', (req, res) => {
  res.status(200).send('Healthy');
});

// Endpoint for searching and storing tweets
app.get('/search', async (req, res) => {
  if (req.headers['x-api-key'] !== process.env.DONKEE_SECRET_KEY) {
    console.log('Unauthorized access attempt for /search endpoint');
    return res.status(401).send('Unauthorized');
  }
  
  try {
    await searchAndStoreTweets();
    res.status(200).send('Tweets searched and stored');
  } catch (error) {
    console.error('Search and store operation failed:', error);
    res.status(500).send('Error in search and store operation');
  }
});

// Endpoint for posting a new tweet
app.get('/tweet', async (req, res) => {
  if (req.headers['x-api-key'] !== process.env.DONKEE_SECRET_KEY) {
    console.log('Unauthorized access attempt for /tweet endpoint');
    return res.status(401).send('Unauthorized');
  }
  
  try {
    const newTweetText = await generateNewTweet();
    // Note: With the free tier, you're limited to 17 tweets per 24 hours
    await twitterClientOAuth2.v2.tweet(newTweetText + " #ForEntertainmentOnly #NotFinancialAdvice");
    console.log('New tweet posted:', newTweetText);
    res.status(200).send('New tweet posted');
  } catch (error) {
    console.error('Tweet posting failed:', error);
    res.status(500).send('Error posting tweet');
  }
});

// Endpoint for replying to the best tweet
app.get('/reply', async (req, res) => {
  if (req.headers['x-api-key'] !== process.env.DONKEE_SECRET_KEY) {
    console.log('Unauthorized access attempt for /reply endpoint');
    return res.status(401).send('Unauthorized');
  }
  
  try {
    // With the free tier, each reply counts towards your 17 tweets per day
    await generateAndPostComment();
    res.status(200).send('Comment posted');
  } catch (error) {
    console.error('Reply posting failed:', error);
    res.status(500).send('Error posting reply');
  }
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  server.setTimeout(180000); // 3 minutes server timeout
});
