---
title: Usar a API do Macondo
description: Crie uma chave de API pessoal e leia os seus dados do Macondo (projetos, sequências, diários) a partir dos seus próprios scripts e ferramentas, sem cookies de sessão.
section: guides
order: 8
icon: key
---
# Usar a API do Macondo

Quer construir um painel, um bot de estatísticas ou um script sobre a sua conta do Macondo? As chaves de API pessoais dão às suas ferramentas acesso programático sem pegar emprestado o cookie de sessão do seu navegador (que expira após 30 dias).

## Obtenha uma chave

1. Vá até [a sua página de chaves de API](/settings/api-keys) (também vinculada no seu perfil, em Contas vinculadas).
2. Dê à chave um rótulo que diga para que ela serve, por exemplo o nome da sua ferramenta.
3. Escolha uma expiração, ou deixe em "Nunca".
4. Copie a chave imediatamente. Ela é mostrada exatamente uma vez; o Macondo só guarda um hash dela.

As chaves têm o formato `macondo_pat_...`. Você pode ter até 5 chaves ativas, e pode revogar qualquer uma a qualquer momento na mesma página.

## Faça solicitações

Envie a chave como token bearer no cabeçalho `Authorization`:

```bash
curl -H "Authorization: Bearer macondo_pat_SUA_CHAVE" \
  https://macondo.hackclub.com/api/auth/me
```

Os endpoints são os mesmos que o site usa, então tudo o que você vê o site buscar, a sua chave também pode ler. Alguns pontos de partida úteis:

- `/api/auth/me`: quem você é, contadores de sequência, indicadores de conta
- `/api/projects`: os seus projetos
- `/api/projects/{id}`: um projeto, incluindo os diários
- `/api/profile/streaks`: a sua sequência e os seus congeladores

Como são os endpoints do próprio site, o formato das respostas pode mudar sem aviso. Programe de forma defensiva.

## O que as chaves podem e não podem fazer

- **Somente leitura.** Só funcionam solicitações `GET`. Uma chave nunca pode comprar na loja, enviar um projeto, editar diários ou excluir nada.
- **Apenas a sua conta.** A chave age como você e vê o que você pode ver.
- **Sem superfícies de staff ou admin.** Os endpoints internos sempre rejeitam chaves.
- **Sem endereços residenciais.** `/api/auth/me` omite os endereços do seu cofre de PII quando chamado com uma chave.

## Limites de taxa

Cada chave tem 20 solicitações por 5 segundos e 60 solicitações por minuto. Além disso você recebe uma resposta `429` com um cabeçalho `Retry-After` indicando quanto tempo esperar.

## Se uma chave vazar

Trate as chaves como senhas. Se uma acabar num repositório público ou num arquivo de log, revogue-a em [a página de chaves de API](/settings/api-keys) imediatamente; a revogação surte efeito em segundos. Depois crie uma nova.
