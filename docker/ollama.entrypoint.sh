#!/bin/bash

# Start Ollama in the background.
/bin/ollama serve &
# Record Process ID.
pid=$!

# Pause for Ollama to start.
sleep 5

#echo "------- Pull models -------"
#ollama pull deepseek-r1:1.5b
#echo "------- Done -------"

# Wait for Ollama process to finish.
wait $pid