# Correções prioritárias da revisão final

## Objetivo

Resolver os achados FR-001 a FR-005 de `docs/FINAL-REVIEW.md` com mudanças
estreitas nos pontos responsáveis. A entrega deve restaurar o gate oficial do
backend, manter a API disponível quando o frontend estático não estiver
presente, alinhar o teste de cores ao contrato efetivo e tornar falhas SQLite
classificáveis e diagnosticáveis sem expor dados do usuário.

## Escopo

Esta entrega inclui:

- configurar o pytest para coletar módulos de teste com nomes repetidos;
- degradar para execução API-only quando `STATIC_DIRECTORY` não for um
  diretório existente;
- oficializar a aceitação case-insensitive de cores `#RRGGBB` nos testes;
- restringir o conflito de criação de etiqueta às violações de unicidade;
- registrar falhas SQLite em nível `ERROR` com contexto HTTP seguro;
- executar os gates completos e verificar que contratos gerados não mudaram.

Esta entrega não inclui:

- reorganização ou renomeação ampla dos testes;
- uma nova camada genérica de erros de persistência;
- mudança de contrato HTTP, OpenAPI ou formato persistido;
- criação automática do diretório estático ausente;
- logging de payloads, conteúdo, query strings ou valores de parâmetros;
- correções de desempenho ou dos links documentais FR-006 e FR-007.

## Decisões de design

### Coleta do pytest

`pyproject.toml` definirá `--import-mode=importlib` na configuração do pytest.
Esse modo já coletou a suíte completa durante a revisão e elimina a colisão
entre arquivos como:

- `backend/tests/unit/documents/test_service.py`;
- `backend/tests/unit/reading_exceptions/test_service.py`.

O comando público continua sendo `uv run pytest`; consumidores não precisarão
conhecer nem repetir o argumento. A mudança deve preservar todos os testes e
seus comportamentos, não apenas ocultar ou excluir módulos conflitantes.

### Frontend estático opcional

`create_app()` tratará `STATIC_DIRECTORY` como uma capacidade opcional. A
montagem de assets, arquivos da raiz e fallback SPA só será configurada quando
o caminho for um diretório existente.

Quando o valor estiver ausente, apontar para arquivo ou apontar para caminho
inexistente:

- a aplicação e o banco ainda serão inicializados;
- `/api/health` e todas as rotas `/api` continuarão disponíveis;
- rotas de frontend retornarão 404;
- nenhum diretório será criado implicitamente;
- a configuração incorreta não será reinterpretada como diretório vazio.

O comportamento atual com diretório válido permanece inalterado, inclusive a
precedência das rotas `/api`, assets, arquivos da raiz e deep links da SPA.

### Contrato de cores

O contrato oficial continua aceitando exatamente `#` seguido de seis dígitos
hexadecimais, sem distinção entre maiúsculas e minúsculas. O modelo e o OpenAPI
não mudam.

O caso `#ffffff` deixará de integrar a tabela de payloads malformados e passará
a ser uma aceitação positiva explícita. Casos sem `#`, com tamanho incorreto,
caracteres fora de hexadecimal, string vazia ou whitespace continuarão
retornando 422.

### Classificação da duplicidade de etiqueta

`SqliteDocumentRepository.create_tag()` capturará somente
`sqlite3.IntegrityError`. A exceção será convertida para o conflito de domínio
existente apenas quando o código estendido SQLite for:

- `SQLITE_CONSTRAINT_UNIQUE`; ou
- `SQLITE_CONSTRAINT_PRIMARYKEY`.

Como a operação contém apenas o `INSERT` na tabela `tags`, esses códigos
representam a unicidade case-insensitive de `tags.name`. Outras constraints e
demais subclasses de `sqlite3.Error` devem propagar para o handler global.

A API mantém 409 para uma etiqueta duplicada. Falhas operacionais, corrupção,
indisponibilidade e constraints não classificadas não podem ser apresentadas
como “Tag already exists”.

### Logging SQLite seguro

O módulo de erros da API terá um logger de módulo. Ao capturar `sqlite3.Error`,
o handler registrará uma ocorrência em nível `ERROR`, preservando a exceção
para traceback.

O contexto permitido é:

- classe/tipo da exceção;
- método HTTP;
- template da rota FastAPI/Starlette, quando disponível.

O template da rota deve ser usado em vez do caminho resolvido para não incluir
UUIDs, nomes de etiquetas, lemmas ou outros valores. Se o template não estiver
disponível, o log usará um marcador neutro. É proibido registrar:

- corpo ou payload da requisição;
- conteúdo ou título de documentos;
- query string;
- caminho resolvido com valores;
- URL de origem, tokens, credenciais ou dados pessoais.

A resposta pública permanece 503 `application/problem+json` com o detalhe
sanitizado atual. Duplicidade esperada de etiqueta continua 409 e não será
registrada como indisponibilidade SQLite.

## Fluxos resultantes

### Inicialização sem frontend compilado

1. `create_app()` recebe ou lê `STATIC_DIRECTORY`.
2. O caminho é convertido em `Path`.
3. Se não for diretório, nenhuma rota estática é registrada.
4. A API criada continua funcional.
5. Rotas desconhecidas seguem o 404 padrão com Problem Details.

### Criação de etiqueta

1. A API valida nome e cor.
2. O repositório executa o `INSERT`.
3. Violação UNIQUE/PRIMARY KEY vira o conflito conhecido e retorna 409.
4. Outra falha SQLite propaga.
5. O handler registra contexto seguro e retorna 503 sanitizado.

## Estratégia de testes

### Gate de coleta

- Executar o comando oficial `uv run pytest` sem `--import-mode` adicional.
- Confirmar que os dois módulos `test_service.py` são coletados e executados.
- Comparar o total coletado com a suíte esperada e reportar skips.

### Runtime estático

- Reusar e ampliar o teste de diretório ausente para provar 404 no frontend.
- Provar `/api/health` 200 na mesma aplicação.
- Provar que o caminho ausente não foi criado.
- Preservar os testes de assets, arquivos da raiz, deep links e rotas `/api`.

### Cores

- Testar `#ffffff` e uma cor com letras maiúsculas como casos válidos.
- Manter a matriz de formatos realmente inválidos em 422.
- Confirmar que OpenAPI e tipos gerados não mudam.

### Erros SQLite e logs

- Preservar 409 para duplicidade com diferença apenas de caixa.
- Simular uma falha SQLite operacional e provar 503.
- Usar captura de logs para provar uma única ocorrência em `ERROR`.
- Verificar método e template da rota.
- Inserir sentinelas em payload e valores de rota e provar que não aparecem no
  log.
- Provar que o conflito esperado não gera log de indisponibilidade.

### Gates finais

- backend completo pelo comando oficial;
- frontend completo;
- userscript completo e `node --check` no bundle;
- build TypeScript/Vite;
- `docker compose config --quiet`;
- paridade de `frontend/openapi.json` e `generated.ts`;
- paridade do bundle do userscript;
- `git diff --check` e inventário final do workspace.

## Critérios de aceite

1. `uv run pytest` coleta e executa toda a suíte sem contorno na linha de
   comando.
2. O diretório estático ausente não impede a API de iniciar e não é criado.
3. Hexadecimais válidos em qualquer caixa são aceitos de modo consistente.
4. Somente duplicidade de nome de etiqueta produz 409.
5. Outras falhas SQLite produzem 503 e exatamente um log seguro em `ERROR`.
6. Nenhum contrato HTTP, OpenAPI ou persistido muda.
7. Todos os gates aplicáveis passam; limitações ambientais são reportadas
   separadamente de defeitos do produto.

## Riscos e mitigação

- **Classificação SQLite incorreta:** testar códigos estendidos reais para
  duplicidade e uma falha não relacionada.
- **Vazamento em logs:** usar template de rota e testes negativos com sentinelas.
- **Rota SPA capturando `/api`:** preservar os testes existentes de precedência.
- **Mudança silenciosa na descoberta:** executar o comando oficial e conferir
  módulos e total coletado.
- **Mudança acidental de contrato:** regenerar artefatos apenas em área isolada e
  comparar hashes/diffs antes de concluir.
