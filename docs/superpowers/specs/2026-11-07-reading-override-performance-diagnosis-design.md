# Diagnóstico de latência das correções de leitura

## Objetivo

Diagnosticar, sem implementar otimizações, a latência percebida ao alterar ou
remover o furigana de uma palavra enquanto um documento já está aberto no
reader. O diagnóstico deve separar frontend, HTTP, serviço, persistência,
análise/cache, serialização e render, identificar gargalos sustentados por
evidência e preparar uma terceira etapa dedicada à implementação.

Esta entrega também resolve o achado documental FR-007 de
`docs/FINAL-REVIEW.md`.

## Contexto e hipótese prioritária

A revisão final mediu regressão no benchmark amplo do reader, mas a percepção
do usuário localiza o problema principal no fluxo de correção de furigana com
o texto já aberto. A lentidão ocorre tanto em “somente esta ocorrência” quanto
em “todas as ocorrências desta palavra”.

O trabalho começará no fluxo end-to-end de correção de leitura. A abertura
geral do reader e outros fluxos só serão aprofundados se o profiling revelar
um componente compartilhado. A associação com exceções, overrides, análise ou
render é hipótese; não será tratada como causa antes das medições.

## Escopo

Esta entrega inclui:

- estabelecer uma baseline reproduzível para set e delete de correção local e
  global;
- decompor a latência por estágio do fluxo;
- variar tamanho do documento, temperatura do cache e volume de
  exceções/overrides;
- aprofundar profiling apenas no estágio dominante;
- preservar e verificar todas as garantias funcionais do reader;
- produzir resultados brutos ignorados e um relatório rastreado;
- classificar candidatos de otimização para uma terceira etapa;
- substituir os links inexistentes do README por referências rastreadas.

Esta entrega não inclui:

- implementação de otimização;
- mudança de contrato HTTP, OpenAPI, persistência ou cache;
- telemetria permanente de produção criada apenas para o diagnóstico;
- virtualização, chunking, paginação ou limites novos de conteúdo;
- análise ampla de biblioteca, etiquetas, importação ou catálogo de exceções,
  salvo quando um componente compartilhado aparecer como gargalo;
- thresholds temporais frágeis na suíte de CI.

## Cenários de medição

### Operações

Cada tamanho de documento cobrirá:

1. criar correção somente para a ocorrência;
2. substituir correção somente para a ocorrência;
3. remover correção somente para a ocorrência;
4. criar correção para todas as ocorrências da palavra;
5. substituir correção para todas as ocorrências da palavra;
6. remover correções de todas as ocorrências da palavra.

### Dimensões

- documento pequeno, médio e grande, com fixture determinística;
- token com uma ocorrência e token repetido muitas vezes;
- análise fria e análise quente;
- zero, quantidade típica e quantidade elevada de exceções globais;
- zero, quantidade típica e quantidade elevada de overrides existentes;
- no mínimo três amostras por cenário, mantendo todas as amostras e a mediana.

Os tamanhos e volumes concretos serão escolhidos a partir das fixtures e da
baseline já existentes, evitando gerar cenários artificiais maiores do que o
necessário para separar tendências.

## Funil de latência

O diagnóstico observará, nesta ordem:

1. evento de submissão e estado pendente do diálogo;
2. requisição `PUT` ou `DELETE` de reading override;
3. validação da revisão, offsets, leitura e vocabulary key;
4. localização do token alvo;
5. escrita ou remoção no repositório;
6. invalidação e reanálise/cache;
7. montagem e serialização da resposta;
8. reconciliação do estado do reader;
9. commit React e atualização visual dos tokens afetados.

Backend e frontend terão medições separadas. Uma amostra local integrada será
usada para confirmar que a soma e a ordem dos estágios representam a
experiência real. Se automação de browser compatível não estiver disponível, a
limitação será registrada e haverá checkpoint manual; jsdom não será apresentado
como prova de latência em navegador real.

## Instrumentação

A instrumentação será preferencialmente implementada em scripts de benchmark,
fixtures e testes diagnósticos. Código de produção só poderá receber um ponto de
medição temporário quando o estágio não puder ser observado por outra via; esse
ponto deve ser removido antes da conclusão do diagnóstico.

As ferramentas serão aplicadas em funil:

- wall clock e mediana para localizar o estágio dominante;
- contagem e duração de queries SQLite quando persistência/análise dominar;
- hits/misses e número de análises quando cache dominar;
- `cProfile` no backend quando CPU Python dominar;
- tamanho e tempo de JSON quando serialização/transporte dominar;
- React Profiler, duração de commits e quantidade de tokens reprocessados quando
  atualização do frontend dominar.

Não serão adicionadas dependências antes de verificar se as ferramentas já
presentes cobrem a medição. Qualquer ferramenta adicional exigirá justificativa
no plano de execução.

## Métricas registradas

Para cada cenário:

- latência percebida entre submissão e atualização visível;
- duração total da requisição;
- duração da validação e localização do token;
- número e duração de operações SQLite;
- quantidade de invalidações, análises e hits/misses de cache;
- duração e tamanho da serialização;
- tamanho da resposta;
- duração dos commits React;
- quantidade aproximada de tokens reprocessados;
- resultado funcional e contagem de ocorrências alteradas.

O ambiente registrará SO, CPU, memória, Python, Node, dependências relevantes,
commit, branch e condições de execução. Resultados concorrentes com outras
cargas significativas serão descartados e repetidos.

## Critério de confirmação

Um gargalo só será classificado como confirmado quando:

- dominar consistentemente a mediana ou explicar a maior parte da variação;
- repetir nos fluxos local e global, ou houver explicação comprovada para a
  diferença;
- permanecer identificável após aquecimento;
- possuir trace, perfil, contagem ou outra evidência compatível;
- ter limite superior de ganho coerente com sua participação no tempo total.

Se nenhum estágio dominar, o relatório será explicitamente inconclusivo e
prescreverá a próxima medição. Ele não recomendará uma implementação com base
apenas em intuição.

## Artefatos

### Resultados brutos

JSON, profiles e traces serão gravados sob `.dev/performance/reading-overrides/`
e permanecerão ignorados pelo Git. Cada execução terá metadados suficientes
para reprodução.

### Relatório rastreado

`docs/performance/reading-override-latency.md` conterá:

- ambiente e método;
- matriz realmente executada e lacunas;
- amostras e medianas;
- decomposição da latência;
- gargalos confirmados, rejeitados e ainda incertos;
- candidatos ordenados por impacto, confiança, custo e risco;
- limitações de browser/runtime;
- recomendação de continuidade.

### Handoff para a terceira etapa

Cada candidato deverá registrar:

1. evidência que o sustenta;
2. ganho máximo teoricamente possível;
3. comportamento e contratos que deve preservar;
4. risco de regressão;
5. teste que deverá falhar antes da futura otimização;
6. critério mensurável de sucesso;
7. critério de rollback.

O relatório recomendará o primeiro candidato somente quando houver evidência
suficiente. A implementação será especificada e planejada em uma terceira
etapa após aprovação humana separada.

## Garantias a preservar

- `Document.content` continua canônico.
- Revisão, hash, versão de analisador/dicionário, exceções e opções continuam
  participando da compatibilidade do cache.
- Correção local altera apenas a ocorrência selecionada.
- Correção global altera exatamente as ocorrências correspondentes e reporta a
  contagem correta.
- Offsets, superfícies, leituras e vocabulary keys permanecem coerentes.
- Texto nativo, seleção/cópia e `ruby`/`rt` permanecem disponíveis.
- Falhas preservam Problem Details e o estado reconciliado do cliente.
- Nenhuma medição temporal passa a bloquear CI por variação de máquina.

## Estratégia de verificação

- Executar os testes determinísticos existentes antes da instrumentação.
- Vincular fixtures por hash e validar reconstrução do conteúdo.
- Comparar respostas e estado visual antes/depois da instrumentação.
- Repetir testes locais e globais de reading override.
- Executar o benchmark amplo atual apenas como contexto, não como causa.
- Executar backend, frontend, userscript e build completos ao concluir.
- Remover toda instrumentação temporária de produção e confirmar workspace.
- Registrar separadamente qualquer etapa manual ou não executada.

## Correção documental FR-007

O README deixará de apontar para:

- `docs/superpowers/specs/2026-09-26-japanese-reader-design.md`;
- `docs/superpowers/plans/2026-09-26-japanese-reader-mvp.md`.

Esses arquivos não existem e não serão recriados retrospectivamente. A seção
passará a referenciar:

- `AGENTS.md` para visão arquitetural rastreada e convenções atuais;
- os designs específicos existentes sob `docs/superpowers/specs/` quando o
  leitor precisar do histórico das features de leitura.

A redação não afirmará que um documento posterior é o plano original do MVP.

## Critérios de aceite

1. Existe baseline reproduzível para set/delete local e global.
2. A latência está decomposta por estágio, com amostras e medianas.
3. Gargalos possuem evidência e limite superior de ganho, ou o resultado é
   declarado inconclusivo com próxima medição explícita.
4. Nenhuma otimização de produto é implementada.
5. Instrumentação temporária de produção é removida.
6. Garantias funcionais e suítes existentes permanecem válidas.
7. O relatório contém um handoff suficiente para especificar a terceira etapa.
8. O README não possui links locais quebrados nem reescreve a história do MVP.

## Riscos e mitigação

- **Otimizar o fluxo errado:** começar pela interação lenta indicada pelo usuário
  e medir end-to-end antes de microbenchmarks.
- **Confundir jsdom com browser:** separar evidências e exigir checkpoint local
  integrado ou registrar a limitação.
- **Medições ruidosas:** usar fixtures determinísticas, três ou mais amostras,
  ambiente registrado e execução sem carga concorrente relevante.
- **Instrumentation bias:** comparar comportamento e remover pontos temporários.
- **Escopo crescer para otimização:** aplicar o stop condition e reservar qualquer
  mudança de desempenho para a terceira etapa.
- **Quebrar semântica do reader:** executar invariantes de conteúdo, offsets,
  seleção e leitura em todos os cenários relevantes.
