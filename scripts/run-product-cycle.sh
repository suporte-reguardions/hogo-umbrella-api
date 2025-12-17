#!/bin/bash

echo "🔄 Executando atualização de ciclos de produtos..."
echo "📅 Data/Hora: $(date)"
echo "🌍 API URL: ${API_URL}"

curl -X POST "${API_URL}/api/product-cycles/run-update" \
  -H "x-api-key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -w "\n📊 Status HTTP: %{http_code}\n" \
  -s -S

if [ $? -eq 0 ]; then
  echo "✅ Execução concluída com sucesso!"
else
  echo "❌ Erro na execução!"
  exit 1
fi