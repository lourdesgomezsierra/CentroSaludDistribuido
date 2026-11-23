FROM python:3.12-slim
WORKDIR /app
COPY requirements-sync.txt /app/requirements-sync.txt
RUN pip install --no-cache-dir -r /app/requirements-sync.txt
COPY python/sincronizarNodos.py /app/python/sincronizarNodos.py
COPY python/verificarConectividadNodos.py /app/python/verificarConectividadNodos.py
COPY tests/test_reintentos.py /app/tests/test_reintentos.py
CMD ["python", "/app/python/sincronizarNodos.py"]
