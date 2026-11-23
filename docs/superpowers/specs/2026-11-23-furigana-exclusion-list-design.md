# Lista global de exclusão de furigana

## Objetivo

Permitir que o usuário mantenha uma lista global de palavras cujo furigana
deve iniciar oculto quando um documento é aberto no leitor. A exclusão muda
somente a visibilidade inicial: o usuário continua podendo mostrar ou ocultar
o furigana de uma palavra pelo controle existente do documento.

A lista se aplica tanto a documentos novos quanto a documentos existentes
quando forem abertos ou recarregados. Adicionar ou remover uma entrada não
altera o texto que já está renderizado na sessão atual.

## Escopo

Esta entrega inclui:

- persistência SQLite global da lista de exclusão;
- repositórios em memória e SQLite;
- serviço e API para listar, adicionar e remover entradas;
- regeneração do contrato OpenAPI e dos tipos TypeScript;
- carga da lista ao abrir o leitor;
- resolução da visibilidade inicial com a precedência definida neste documento;
- item no menu contextual para adicionar ou remover a leitura da lista;
- aviso quando a alteração da lista não puder ser persistida;
- testes de domínio, persistência, API, cliente e interface;
- comparação de desempenho entre as identidades `lemma + leitura de
  dicionário` e `lemma`.

Esta entrega não inclui:

- página própria para administrar a lista completa;
- importação, exportação, busca ou edição em lote;
- atualização imediata das ocorrências no documento já aberto;
- mudanças no conteúdo canônico do documento;
- mudanças na análise morfológica, no alinhamento de furigana ou no cache de
  análise;
- sincronização com contas ou serviços externos;
- exclusão lógica, histórico ou auditoria das entradas.

## Identidade da exclusão

A identidade escolhida inicialmente é o par exato:

```text
(lemma, dictionary_reading)
```

Essa identidade distingue palavras que compartilham o mesmo lemma, mas têm
leituras de dicionário diferentes. A correspondência não usa a leitura efetiva
de um override por ocorrência. Uma correção local de leitura, portanto, não
muda a entrada global que corresponde ao token.

Somente tokens lexicais com lemma não vazio e `dictionaryReading` não nula e
não vazia podem ser adicionados ou removidos pelo menu. Tokens sem leitura de
dicionário continuam seguindo as preferências atuais e não exibem a nova ação.

O frontend reutiliza a codificação estável já usada por `VocabularyKey` para
comparações em `Set` e `Map`, mas constrói a chave da exclusão diretamente de
`token.lemma` e `token.dictionaryReading`. Ele não usa `vocabularyKey` como
substituto, porque essa chave pode recorrer à leitura efetiva quando a leitura
de dicionário está ausente.

## Decisão condicionada por desempenho

`lemma + leitura de dicionário` permanece como identidade final salvo se a
medição aprovada demonstrar que a estratégia por `lemma` é pelo menos 100 ms
mais rápida na mediana para o carregamento e a renderização do cenário grande
do leitor.

A comparação deve:

1. reutilizar o corpus determinístico e os tamanhos progressivos do teste de
   desempenho do leitor, incluindo o maior tamanho que concluir dentro do
   limite atual desse teste;
2. aquecer cada estratégia antes de coletar amostras;
3. executar pelo menos cinco amostras intercaladas de cada estratégia para
   reduzir viés de ordem;
4. medir a construção das chaves, as consultas ao conjunto de exclusões e a
   renderização de `DocumentText`;
5. comparar as medianas das estratégias no mesmo processo e ambiente;
6. imprimir as amostras e medianas brutas como evidência.

O limite de 100 ms é uma decisão de implementação, não uma asserção permanente
de tempo em CI. Se a diferença for menor que 100 ms, a chave composta será
mantida. Se `lemma` for pelo menos 100 ms mais rápido, toda a implementação
adotará somente `lemma`: esquema, modelos, API, cliente, testes e documentação
usarão uma única identidade coerente. Não haverá mistura das duas estratégias.

## Modelo de dados

Na estratégia inicial, a próxima migração SQLite cria:

```sql
CREATE TABLE furigana_exclusions (
    lemma TEXT NOT NULL,
    dictionary_reading TEXT NOT NULL,
    PRIMARY KEY (lemma, dictionary_reading)
);
```

Não serão adicionados identificador artificial, timestamps ou `deleted_at`,
pois a funcionalidade requer somente associação e remoção idempotentes. A
ordem de listagem será determinística por `lemma` e `dictionary_reading`.

A `PRIMARY KEY` composta é também o índice de consulta da tabela. No SQLite,
ela cria automaticamente um índice único ordenado por `(lemma,
dictionary_reading)`, adequado à correspondência exata usada pelo serviço e à
ordenação da listagem. A migração não criará um segundo índice com as mesmas
colunas, pois ele duplicaria armazenamento e manutenção sem ampliar os padrões
de consulta aprovados. Se a decisão de desempenho adotar somente `lemma`, a
chave primária e seu índice correspondente também passarão a usar somente essa
coluna.

Adicionar uma chave já existente não altera o resultado nem causa erro.
Remover uma chave inexistente também é uma operação bem-sucedida sem efeito.

## Componentes backend

### Domínio e repositório

`FuriganaExclusion` representa a identidade imutável da entrada. O contrato de
repositório expõe:

- listagem de todas as entradas em ordem determinística;
- adição idempotente;
- remoção idempotente.

As implementações em memória e SQLite devem observar o mesmo contrato. O
repositório é global e não recebe `document_id`.

### Serviço

`FuriganaExclusionService` valida que lemma e leitura de dicionário não sejam
vazios e delega as operações ao repositório. Ele não acessa documentos,
análises, overrides ou preferências por documento.

### API

A API expõe uma coleção global:

```text
GET    /api/furigana-exclusions
PUT    /api/furigana-exclusions
DELETE /api/furigana-exclusions
```

`GET` retorna a lista de chaves. `PUT` e `DELETE` recebem no corpo a chave com
`lemma` e `dictionaryReading` e respondem com `204 No Content`. Os dois verbos
são idempotentes.

Entradas estruturalmente inválidas são rejeitadas sem persistência. Erros
continuam seguindo o tratamento existente de `application/problem+json`. Não
será criado um formato paralelo de erro.

O serviço e o router serão compostos nos pontos existentes de criação da
aplicação. A alteração de contrato exige executar `npm run api:generate` e
versionar juntos `frontend/openapi.json` e os tipos TypeScript gerados.

## Carregamento e estado do leitor

Ao abrir ou recarregar um documento, `ReaderPage` carrega em paralelo:

- documento;
- seleções de vocabulário;
- preferências de exibição por documento;
- lista global de exclusões.

A análise mantém o fluxo atual. A lista de exclusão é um dado de apresentação
e não participa de `AnalysisOptions`, da identidade do cache nem da invalidação
de análises.

Uma falha ao carregar a lista falha o carregamento do leitor, em vez de exibir
furigana que deveria estar oculto sem avisar o usuário. O fluxo de erro e nova
tentativa continua sendo o já usado pelo leitor.

O frontend mantém dois conjuntos distintos:

1. **exclusões aplicadas**, capturadas no início do carregamento e usadas
   durante toda a renderização atual;
2. **exclusões atuais**, atualizadas após operações bem-sucedidas e usadas para
   definir qual ação o menu contextual apresenta.

Essa separação garante que adicionar ou remover uma entrada troque a ação do
menu, mas não altere o furigana já renderizado. Um novo carregamento substitui
os dois conjuntos pelo estado persistido mais recente.

## Precedência da visibilidade

Para cada token elegível, a visibilidade é resolvida nesta ordem:

1. preferência explícita `show` do documento: mostrar;
2. preferência explícita `hide` do documento: ocultar;
3. preferência `inherit` e chave presente nas exclusões aplicadas: ocultar;
4. preferência `inherit` e chave ausente: seguir `showFurigana` da configuração
   geral do leitor.

Consequentemente, o usuário pode escolher “Mostrar furigana” para uma palavra
excluída e essa preferência explícita prevalece naquele documento. “Seguir
configuração geral” remove a preferência explícita e volta a considerar a
lista global antes da configuração geral.

Preferências por documento já persistidas não são migradas, apagadas ou
reescritas quando a lista global muda.

## Menu contextual

O menu de um token elegível recebe uma ação junto de “Corrigir leitura” e do
controle existente de visibilidade:

- “Adicionar leitura à lista de exclusão”, quando a chave não está na lista
  atual;
- “Remover leitura da lista de exclusão”, quando a chave está na lista atual.

Durante a requisição, a ação fica indisponível para impedir operações
duplicadas. Após sucesso, somente o conjunto atual e o rótulo da ação mudam.
As exclusões aplicadas permanecem inalteradas até o próximo carregamento.

Se a operação falhar, o conjunto atual permanece como estava e `ReaderPage`
mostra um aviso com `role="alert"` separado do conteúdo do documento. A mensagem
neutra será “Não foi possível atualizar a lista de exclusão de furigana.” O
foco retorna ao token depois do fechamento do menu, seguindo o comportamento
existente.

## Compatibilidade

- `Document.content` permanece canônico.
- A análise e seus segmentos de furigana permanecem completos; a interface
  apenas controla o atributo `hidden` de `rt`.
- Correções de leitura por ocorrência mantêm seu funcionamento e precedência.
- Seleções de vocabulário e preferências de exibição existentes não mudam de
  formato.
- O botão geral de furigana continua controlando tokens em modo herdado que
  não estejam excluídos.
- Nenhuma entrada inicial será inserida pela migração.

## Estratégia de testes

### Persistência e domínio

- a migração cria a tabela em bancos novos e existentes;
- reabrir o banco não reaplica a migração;
- adicionar a mesma chave é idempotente;
- remover chave existente ou ausente é idempotente;
- leituras diferentes do mesmo lemma permanecem entradas distintas;
- a listagem é determinística;
- a migração cria o índice único da chave primária nas colunas e na ordem
  esperadas, verificado pelos metadados `PRAGMA index_list` e
  `PRAGMA index_info`;
- os repositórios em memória e SQLite satisfazem o mesmo contrato;
- lemma ou leitura vazios são rejeitados.

### API e cliente

- `GET` devolve as entradas persistidas;
- `PUT` e `DELETE` transportam a chave completa e retornam `204`;
- caracteres japoneses são preservados;
- payload inválido segue problem-details;
- o cliente TypeScript usa os tipos OpenAPI gerados;
- OpenAPI e tipos gerados permanecem sincronizados.

### Visibilidade e carregamento

- exclusão herdada oculta o furigana;
- `show` explícito prevalece sobre exclusão;
- `hide` explícito continua ocultando;
- chave não excluída em `inherit` segue a configuração geral;
- outra leitura do mesmo lemma não corresponde à exclusão inicial;
- token sem leitura de dicionário não é elegível;
- documentos existentes recebem a lista ao serem reabertos;
- adicionar ou remover não muda a renderização atual;
- recarregar aplica a lista persistida mais recente;
- falha ao carregar a lista não exibe o leitor com um padrão incorreto.

### Menu e falhas

- a ação de adicionar aparece para chave ausente;
- a ação de remover aparece para chave presente;
- sucesso troca a ação sem trocar a visibilidade atual;
- operação pendente não pode ser duplicada;
- falha preserva estado, apresenta alerta e permite tentar novamente;
- ações existentes de leitura e furigana continuam disponíveis.

### Desempenho e regressão

- executar a comparação pareada descrita neste documento;
- registrar estratégia escolhida, amostras e medianas;
- executar testes focados de backend e frontend;
- executar as suítes completas de backend e frontend;
- executar o build de produção do frontend;
- executar `git diff --check`;
- tratar validação manual no navegador e Docker como evidências separadas, sem
  inferi-las de testes ou build verdes.

## Critérios de conclusão

1. O usuário consegue adicionar ou remover uma leitura pelo menu contextual.
2. A lista é global, persistente e aplicada a qualquer documento no próximo
   carregamento.
3. A sessão atual não muda visualmente após uma alteração na lista.
4. Preferências explícitas do documento mantêm precedência.
5. A identidade usada em persistência, API e frontend é única e corresponde à
   decisão de desempenho documentada.
6. A comparação pareada possui amostras e medianas reproduzíveis; uma mudança
   para lemma só ocorre com diferença mediana de pelo menos 100 ms.
7. OpenAPI e tipos gerados são atualizados juntos.
8. Testes relevantes, suítes completas, build e verificação do diff são
   executados, com limitações reportadas separadamente.
9. Nenhuma mudança é introduzida na análise linguística, no conteúdo canônico
   ou no comportamento geral de correções de leitura.

## Critérios de reversão

A implementação deve ser revertida ou corrigida antes da integração se:

- alterar o conteúdo ou os segmentos retornados pela análise;
- substituir preferências explícitas por documento;
- atualizar silenciosamente o documento já aberto;
- permitir correspondência ambígua entre identidades;
- exibir furigana como fallback silencioso quando a lista não puder ser
  carregada;
- introduzir regressão material no carregamento sem satisfazer a regra de
  seleção da estratégia alternativa.
