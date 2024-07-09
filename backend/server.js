const express = require('express');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const { Sequelize, DataTypes } = require('sequelize');
const axios = require('axios');
const cors = require('cors');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Set up SQLite database
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: './chat_history.sqlite'
});

// Define Conversation model
const Conversation = sequelize.define('Conversation', {
  userId: DataTypes.STRING,
  messages: DataTypes.TEXT
});

sequelize.sync();

// Function to get room options
async function getRoomOptions() {
  try {
    const response = await axios.get('https://bot9assignement.deno.dev/rooms');
    return response.data;
  } catch (error) {
    console.error('Error fetching room options:', error);
    return [];
  }
}

// Function to book a room
async function bookRoom(roomId, fullName, email, nights) {
  try {
    const response = await axios.post('https://bot9assignement.deno.dev/book', {
      roomId,
      fullName,
      email,
      nights
    });
    return response.data;
  } catch (error) {
    console.error('Error booking room:', error);
    throw error;
  }
}

app.post('/chat', async (req, res) => {
  const { message, userId } = req.body;

  try {
    let conversation = await Conversation.findOne({ where: { userId } });
    if (!conversation) {
      conversation = await Conversation.create({ userId, messages: '[]' });
    }

    const messages = JSON.parse(conversation.messages);
    messages.push({ role: 'user', content: message });

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful hotel booking assistant." },
        ...messages
      ],
      functions: [
        {
          name: "getRoomOptions",
          description: "Get available room options",
          parameters: { type: "object", properties: {} }
        },
        {
          name: "bookRoom",
          description: "Book a room",
          parameters: {
            type: "object",
            properties: {
              roomId: { type: "number" },
              fullName: { type: "string" },
              email: { type: "string" },
              nights: { type: "number" }
            },
            required: ["roomId", "fullName", "email", "nights"]
          }
        }
      ],
      function_call: "auto"
    });

    const assistantMessage = completion.choices[0].message;

    if (assistantMessage.function_call) {
      const functionName = assistantMessage.function_call.name;
      const functionArgs = JSON.parse(assistantMessage.function_call.arguments);

      let functionResult;
      if (functionName === 'getRoomOptions') {
        functionResult = await getRoomOptions();
      } else if (functionName === 'bookRoom') {
        functionResult = await bookRoom(
          functionArgs.roomId,
          functionArgs.fullName,
          functionArgs.email,
          functionArgs.nights
        );
      }

      messages.push(assistantMessage);
      messages.push({
        role: "function",
        name: functionName,
        content: JSON.stringify(functionResult)
      });

      const secondCompletion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are a helpful hotel booking assistant." },
          ...messages
        ]
      });

      messages.push(secondCompletion.choices[0].message);
    } else {
      messages.push(assistantMessage);
    }

    await conversation.update({ messages: JSON.stringify(messages) });

    res.json({ response: messages[messages.length - 1].content });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));