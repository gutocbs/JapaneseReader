# Importação de artigos do note.com

Este diretório contém a userscript gerada para importar artigos compatíveis do
note.com para o Japanese Reader local. O arquivo que deve ser instalado é
`note-import.user.js`; ele é gerado a partir de `config.js`,
`noteExtractor.js`, `readerApiClient.js` e `ui.js`.

## Instalação e uso

1. Instale o Tampermonkey no navegador e, no painel da extensão, importe o
   arquivo local `userscript/note-import/note-import.user.js`.
2. Inicie a API local na raiz do repositório com `npm run dev:backend`.
3. Abra um artigo compatível de `https://note.com/` e use o controle de
   importação inserido após o artigo.

Depois de alterar um dos módulos-fonte, regenere o arquivo instalável com
`node userscript/note-import/build-userscript.mjs` e valide-o com
`node --check userscript/note-import/note-import.user.js`.

O fluxo acima ainda precisa de validação manual em uma instalação real do
Tampermonkey e em um artigo publicado do note.com. Não trate os testes
automatizados como evidência dessa execução no navegador.

## Contrato da API local

- Método e endpoint: `POST /api/imports`.
- URL-base da API no desenvolvimento: `http://127.0.0.1:8000`.
- URL do endpoint no desenvolvimento: `http://127.0.0.1:8000/api/imports`.
- Corpo JSON estrito (propriedades adicionais não são aceitas):
  - `title`: string não em branco;
  - `text`: string;
  - `description`: string ou `null`;
  - `source`: string não em branco;
  - `tags`: array de `{ "name", "color" }`; `name` é string não em branco, `color` segue o formato `#RRGGBB` (seis dígitos hexadecimais, aceitando maiúsculas, minúsculas ou combinação), e os nomes são únicos sem diferenciar maiúsculas de minúsculas.
- Sucesso: `201 Created`, com JSON de `DocumentResponse`.
- Falhas: `application/problem+json`, com `type`, `title`, `status` e `detail`. Os status relevantes no contrato atual incluem `422` e `503`.

## Mapeamento efetivo

| Campo da importação | Origem na página note.com |
| --- | --- |
| `title` | título do artigo |
| `text` | corpo extraído do artigo, preservado sem normalização adicional pelo cliente |
| `description` | URL atual do artigo |
| `source` | `note.com` |
| `tags` | uma tag `{ "name": "note.com", "color": "#7C3AED" }` |

O valor de `text` deve ser enviado como extraído, sem normalização adicional definida por este contrato.

## Transporte e ambiente local

O frontend Vite usa a porta `5173` e encaminha `/api` ao backend na porta `8000`; isto é apenas contexto. A userscript chama a API local diretamente em `http://127.0.0.1:8000/api/imports`.

Não há middleware CORS configurado para essa integração. O transporte planejado é `GM_xmlhttpRequest` do Tampermonkey. A URL-base configurada para a requisição é `http://127.0.0.1:8000`; separadamente, a permissão `@connect` deve listar apenas o host local `127.0.0.1`. Não usar `allow_origins=*`.

Este contrato não pressupõe uma porta de host publicada por Docker. Qualquer porta publicada por uma futura configuração Docker deve ser confirmada na configuração de implantação aplicável antes de ser usada pela userscript.

## Validação reproduzível

1. Execute `node .\\frontend\\node_modules\\vitest\\vitest.mjs run userscript/note-import --reporter=verbose` para a suíte determinística da userscript.
2. Execute `node userscript/note-import/build-userscript.mjs` e `node --check userscript/note-import/note-import.user.js` para regenerar e verificar o bundle.
3. Execute `uv run pytest backend/tests/integration/test_public_import_api.py` para validar o endpoint público, o `201`, os erros `422` e o contrato OpenAPI. A suíte pública de importação deve passar, incluindo a aceitação de cores hexadecimais em maiúsculas, minúsculas ou combinação.

## Não objetivos

Este recorte não inclui outros sites, extração genérica, empacotamento como extensão de navegador, sincronização, edição, seleção manual, gerenciamento de importações nem mudanças no contrato da API.
