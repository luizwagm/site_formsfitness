"use strict";
/* ==========================================================================
   SAÚDE DO ALUNO MENOR (1.35.0; transtornos saíram na 1.37.0)

   Pedido da academia: na matrícula de MENOR de idade, o campo obrigatório
   "alguma questão de saúde?", uma lista com busca. (Havia também "algum
   transtorno?"; saiu na 1.37.0 — a pergunta do acompanhamento individualizado,
   mais abaixo, é a que decide.) As listas moram AQUI e só aqui: o site e o painel as
   recebem do servidor (/api/publico/turmas e /api/gestao/resumo), e é contra
   elas que o servidor confere o que chega. Uma cópia no navegador
   envelheceria, e o servidor passaria a recusar a opção que a tela oferece.

   As opções são as que importam numa aula de natação: o que muda a conduta
   do professor na piscina (asma, convulsão, tubo no ouvido, alergia ao cloro,
   deficiência auditiva…). Várias podem ser marcadas — criança com asma e rinite
   é o caso comum. "Nenhuma" é resposta (e exclui as demais): o campo é
   obrigatório justamente para que o "não tem" seja DITO, e não presumido de
   um campo em branco. "Outra" abre um texto livre.

   Guardado como texto, as opções separadas por "; " — lê-se na ficha, na
   exportação e no banco sem decodificar nada. Por isso o ";" é tirado do
   texto livre.

   É DADO SENSÍVEL (LGPD, art. 11): o consentimento do responsável passou a
   dizer, com todas as letras, que inclui as informações de saúde e para que
   elas servem.
   ========================================================================== */

const SAUDE_NENHUMA = "Nenhuma";
const SAUDE_OUTRA = "Outra (especificar)";
const SAUDE = [
  SAUDE_NENHUMA,
  "Alergia a cloro ou produtos de piscina",
  "Alergia a medicamento",
  "Alergia alimentar",
  "Anemia",
  "Asma",
  "Bronquite",
  "Cardiopatia (doença do coração)",
  "Cirurgia recente",
  "Convulsões / epilepsia",
  "Deficiência auditiva",
  "Deficiência física",
  "Deficiência visual",
  "Dermatite atópica",
  "Desmaios",
  "Diabetes",
  "Doença celíaca",
  "Escoliose ou problema na coluna",
  "Hemofilia ou problema de coagulação",
  "Hipertensão (pressão alta)",
  "Hipotireoidismo ou hipertireoidismo",
  "Intolerância à lactose",
  "Labirintite",
  "Lesão ou problema ortopédico",
  "Micose de pele ou unha",
  "Obesidade",
  "Otite de repetição",
  "Paralisia cerebral",
  "Rinite alérgica",
  "Síndrome de Down",
  "Sinusite",
  "Sopro no coração",
  "Tubo de ventilação no ouvido",
  "Uso contínuo de medicamento",
  SAUDE_OUTRA,
];

/* (1.37.0) A lista de TRANSTORNOS saiu, a pedido da academia: a pergunta do
   acompanhamento individualizado (abaixo) já responde o que importa — e é
   ela, não um diagnóstico, que decide se a matrícula segue. A coluna
   g_alunos.transtornos fica, com o que foi gravado antes; nada novo entra. */

/* O que vai para o site e o painel: a lista, qual é o "nenhum" e qual abre
   o texto livre. */
const LISTAS_SAUDE = {
  saude: { opcoes: SAUDE, nenhuma: SAUDE_NENHUMA, outra: SAUDE_OUTRA, prefixo: "Outra: " },
};

/* Confere e arruma um dos dois campos. Aceita o texto "a; b; Outra: x" ou
   uma lista. Devolve { valor } ou { erro }. Vazio devolve valor "" — se é
   obrigatório, quem decide é quem chama (só para menor, no cadastro novo). */
function normalizarListaSaude(campo, entrada) {
  const def = LISTAS_SAUDE[campo];
  const itens = (Array.isArray(entrada) ? entrada : String(entrada ?? "").split(";"))
    .map((x) => String(x ?? "").replace(/[\x00-\x1F]/g, " ").trim()).filter(Boolean);
  const vistos = new Set(), saida = [];
  for (const item of itens) {
    let ok = null;
    if (def.opcoes.includes(item) && item !== def.outra) ok = item;
    /* "Outra:" com ou sem texto, e o próprio rótulo "Outra (especificar)":
       sem descrição, pede a descrição — e não diz "não é da lista". */
    else if (item === def.outra || item.startsWith(def.prefixo.trim())) {
      const livre = (item === def.outra ? "" : item.slice(def.prefixo.trim().length)).replace(/;/g, ",").replace(/\s+/g, " ").trim().slice(0, 120);
      if (livre.length >= 2) ok = def.prefixo + livre;
      else return { erro: "Descreva qual é a outra questão de saúde." };
    }
    if (!ok) return { erro: "Uma das questões de saúde não é da lista." };
    if (!vistos.has(ok)) { vistos.add(ok); saida.push(ok); }
  }
  if (saida.includes(def.nenhuma) && saida.length > 1)
    return { erro: `Em saúde, "${def.nenhuma}" não combina com outras opções.` };
  if (saida.length > 40) return { erro: "Opções demais marcadas." };
  return { valor: saida.join("; ") };
}

/* ==========================================================================
   NECESSIDADES DO ALUNO MENOR — A PERGUNTA QUE DECIDE (1.36.0)

   Texto da academia (22/10/2026), que SUBSTITUI a trava por transtorno da
   1.35.0 (nunca publicada). A regra mudou de natureza, e para melhor:

     · na 1.35.0, marcar qualquer transtorno travava a matrícula — o bloqueio
       vinha do DIAGNÓSTICO, que é exatamente o que a Lei Brasileira de
       Inclusão (13.146/2015) não admite;
     · agora quem decide é a NECESSIDADE DE SUPORTE: "o aluno precisa de
       acompanhamento individualizado, supervisão adicional ou suporte
       especializado nas aulas?" — que é o serviço que a academia não tem.
       Criança com TEA que não precisa de suporte extra se matricula; criança
       sem diagnóstico que precisa, não. As listas de saúde e transtornos
       continuam, mas só INFORMAM a equipe.

   "Sim" → a mensagem de orientação (editável em Gestão ▸ Configurações) e a
   matrícula não segue pelo site. "Não" → a declaração do responsável, que
   precisa ser aceita antes de o site liberar foto e pagamento.

   Os textos abaixo são os da academia, palavra por palavra. A declaração vai
   gravada no consentimento da ficha, com nome, CPF e hora — com as palavras
   de QUANDO foi aceita, e não as de hoje, se um dia mudarem.
   ========================================================================== */
const NECESSIDADE_PERGUNTA = "O(a) aluno(a) possui alguma condição, deficiência ou necessidade específica que exija " +
  "acompanhamento individualizado, supervisão adicional ou suporte especializado durante as atividades aquáticas?";
const NECESSIDADE_IMPORTANTE = "A Forms Fitness Academia Aquática não dispõe, no momento, de equipe especializada para " +
  "oferecer determinadas modalidades de acompanhamento individualizado ou suporte específico. Por isso, é fundamental " +
  "que as informações fornecidas sejam verdadeiras e completas, para que as necessidades do(a) aluno(a) sejam " +
  "consideradas em relação à segurança e aos recursos disponíveis.";
const MSG_NECESSIDADE_PADRAO = [
  "Olá! Agradecemos pelas informações fornecidas e pela confiança na Forms Fitness Academia Aquática.",
  "Nosso compromisso é oferecer atividades aquáticas com responsabilidade, segurança e respeito às necessidades individuais.",
  "No momento, nossa equipe técnica não dispõe da formação especializada e da estrutura necessárias para oferecer " +
    "determinadas modalidades de acompanhamento específico durante as atividades aquáticas. Por responsabilidade " +
    "profissional, precisamos respeitar os limites dos serviços que conseguimos oferecer com segurança.",
  "Como alternativa, sugerimos consultar instituições que possam oferecer serviços compatíveis com as necessidades do(a) aluno(a):\n" +
    "• Clínica São Gabriel\n• Clínica Fisiotrauma\n• Aquafisio\n• Acqua Angels",
  "Recomendamos entrar em contato diretamente com cada instituição para confirmar a disponibilidade e as condições de atendimento.",
  "Agradecemos a compreensão e desejamos ao(à) aluno(a) saúde, desenvolvimento e bem-estar.",
  "Atenciosamente,\nEquipe Forms Fitness Academia Aquática",
].join("\n\n");
const DECLARACAO_RESPONSAVEL = [
  "Declaro que as informações fornecidas nesta ficha são verdadeiras e completas, comprometendo-me a comunicar à " +
    "Forms Fitness Academia Aquática eventuais informações relevantes para a participação segura do(a) aluno(a) nas atividades aquáticas.",
  "Declaro estar ciente das informações apresentadas pela academia sobre os serviços oferecidos e suas limitações " +
    "quanto à disponibilidade de acompanhamento especializado.",
  "Estou ciente de que a participação nas atividades está condicionada às características do serviço oferecido e às " +
    "condições de segurança disponíveis, observadas as necessidades individuais do(a) aluno(a) e a legislação aplicável.",
];
const DECLARACAO_ACEITE = "Declaro que li e estou ciente das informações acima.";
const NECESSIDADES = ["nao", "sim"];

module.exports = { SAUDE, LISTAS_SAUDE, normalizarListaSaude,
  NECESSIDADE_PERGUNTA, NECESSIDADE_IMPORTANTE, MSG_NECESSIDADE_PADRAO, DECLARACAO_RESPONSAVEL, DECLARACAO_ACEITE, NECESSIDADES };
