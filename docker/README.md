From the root of the project, to start the ollama and python server containers:

```bash
docker compose up -d --build
```

To access the application, open a browser and go to [localhost:8000/src/yla.html](localhost:8000/src/yla.html)

**NOTE**: in case you run the app on a remote server and you have ssh access to the server, you can create a secure connection to the app by forwarding both the web server port and the Ollama port (the browser talks to Ollama directly at `localhost:11434`):

```bash
ssh -L 8000:localhost:8000 -L 11434:localhost:11434 user@server
```

---

To clean things up, run:

```bash
docker image remove yla-server:latest ollama/ollama:latest && \
docker volume rm yla_ollama && \
docker builder prune -f && \
docker system prune -f
```
