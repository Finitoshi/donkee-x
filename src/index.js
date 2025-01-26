const express = require('express');
const axios = require('axios');
const { TwitterApi } = require('twitter-api-v2');
const app = express();

// Initialize Twitter client using environment variables for security
const twitterClient = new TwitterApi({
  appKey: process.env.APP_KEY,
  appSecret: process.env.APP_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_SECRET,
});

/**
 * Generates content using Grok AI and sends a tweet
 */
async function generateContentAndTweet() {
  try {
    // Prepare the prompt for Grok
    const payload = {
      "messages": [
        {
          "role": "system",
          "content": "You are DONKEE, a highly intelligent, edgy, weed-smoking donkey who loves Solana memecoins and degen trading. Your tweets should be witty, playful, and target Gen Z and Millennials. Avoid direct financial advice or promotions."
        },
        {
          "role": "user",
          "content": "Generate a tweet for me."
        }
      ],
      "model": "grok-2-latest",
      "stream": false,
      "temperature": 0.7
    };

    // API call to Grok for text generation
    const response = await axios.post('https://api.x.ai/v1/chat/completions', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
      }
    });

    // Extract the generated text from the response
    const generatedText = response.data.choices[0].message.content;
    console.log('Generated Text:', generatedText);

    // Post the tweet
    await twitterClient.v2.tweet(generatedText + " #ForEntertainmentOnly #NotFinancialAdvice");
    console.log('Tweet sent successfully!');
  } catch (error) {
    console.error('Error in content generation or tweeting:', error.message);
  }
}

// Endpoint to trigger the bot
app.get('/', async (req, res) => {
  try {
    await generateContentAndTweet();
    res.send('Tweet posted successfully');
  } catch (error) {
    console.error('Cron job failed:', error);
    res.status(500).send('Error running bot');
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
