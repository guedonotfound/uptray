# Uptray

Extensão para navegadores Chromium (Helium, Chrome, Brave, Edge, Vivaldi) que recria o
"Easy Files" do Opera: ao clicar para anexar um arquivo, abre um popup com a imagem da
área de transferência e os downloads recentes, com um botão para abrir o Explorer normal.

## Instalação no Helium

1. Extraia esta pasta para um lugar fixo (ex.: `C:\Ferramentas\uptray`). O navegador
   carrega a extensão direto dessa pasta, então não apague nem mova depois.
2. Abra `helium://extensions` (ou `chrome://extensions`).
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta.
5. Em **Detalhes** da extensão, confirme que **Permitir acesso a URLs de arquivo** está
   ativado (necessário para anexar os downloads).
6. Fixe o ícone na barra para acessar as configurações.

## Uso

- Clique em qualquer campo de anexo: o popup aparece.
- Clique num download ou na imagem copiada para anexar.
- Campos que aceitam vários arquivos: clique para selecionar e use **Anexar N arquivos**.
- `Ctrl+V` com o popup aberto cola o que estiver copiado (imagem ou arquivo do Explorer).
- **Procurar no computador…** abre o seletor do Windows. `Esc` fecha.
- Se não houver nada para mostrar, o Explorer abre direto.

## Configurações (ícone da extensão)

- Ligar/desligar geral e por site.
- Mostrar ou não a imagem da área de transferência.
- Quantidade de downloads exibidos.

## Limitações conhecidas

- Sites que usam a API `showOpenFilePicker` (alguns editores web) abrem o seletor nativo.
- Downloads apagados ou movidos somem da lista.
- Arquivos acima de 500 MB precisam ser escolhidos pelo Explorer.
- Na primeira vez em alguns sites, o navegador pode pedir permissão para ler a área de transferência.
