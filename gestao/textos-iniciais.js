/* ==========================================================================
   gestao/textos-iniciais.js — os dois textos que a academia entregou

   MODELO_CONTRATO: transcrito do "Contrato de Academia FITNESS.doc" enviado
   em 11/09/2026. O texto jurídico está como veio — inclusive a grafia —; só
   os DADOS da aluna do exemplo viraram marcadores {{ASSIM}}. Quem mexe no
   texto é a direção, pela tela "Contrato"; cada edição vira uma versão nova.

   CONDICOES_MATRICULA: o texto que sai no fim da ficha impressa. Não aparece
   no formulário do site — só na impressão feita pela gestão.

   Os dois só são gravados UMA vez (ver esquema.js). Mudar este arquivo depois
   não altera o que já está no banco — e é assim que tem de ser, senão um
   deploy desfaria o que a direção escreveu.

   SEM DADO PESSOAL AQUI (1.25.0). O repositório é PÚBLICO no GitHub, e a
   primeira transcrição trazia o RG, o CPF e o endereço de correspondência do
   diretor. A qualificação completa dele fica só no BANCO (tela "Contrato"),
   que não vai para o git; este arquivo é apenas o ponto de partida de uma
   instalação nova.
   ========================================================================== */
"use strict";

/* O modelo usa só marcação ESTRUTURAL (títulos, parágrafos, negrito, lista).
   Alinhamento e tamanho vêm do CSS da impressão: o editor do painel passa pelo
   saneador, que descarta todo atributo — um "text-align" gravado aqui sumiria
   na primeira edição e ninguém saberia por quê. */
const MODELO_CONTRATO = `<h2>CONTRATO DE PRESTAÇÃO DE SERVIÇOS - IDENTIFICAÇÃO DAS PARTES CONTRATANTES</h2>
<p><b>CONTRATANTE:</b> {{CONTRATANTE_NOME}} - {{CODIGO}}, Nacionalidade {{CONTRATANTE_NACIONALIDADE}}, Carteira de Identidade nº {{CONTRATANTE_RG}} e órgão {{CONTRATANTE_RG_EMISSOR}}, C.P.F. nº {{CONTRATANTE_CPF}}, residente e domiciliado na {{ENDERECO}}, nº {{NUMERO}}, bairro {{BAIRRO}}, Cep {{CEP}}, Cidade {{CIDADE}}, no Estado {{UF}}.</p>
<p><b>CONTRATADA:</b> FORMS FITNESS ACADEMIA AQUÁTICA, com endereço de arrendamento na Rua São Vicente Férrer, s/ nº, bairro Boa Vista II, Cidade Caruaru, Cep 55038-570, no Estado PE, inscrita no C.N.P.J. sob o nº 02.192.745/0001-25, devidamente representada neste ato por seu Diretor e Professor, Ronaldo José de Menezes.</p>
<p>As partes acima identificadas têm, entre si, justas e acertadas o presente Contrato de Prestação de Serviços de Academia, que se regerá pelas cláusulas seguintes e pelas condições descritas no presente.</p>
{{#SE_MENOR}}<p>Caso o aluno seja menor de idade: a contratante é o responsável pelo (a) aluno (a) de menor idade por nome de <b>{{ALUNO_NOME}}</b> com data de nascimento, {{ALUNO_NASCIMENTO}} perfazendo {{ALUNO_IDADE}} anos de idade.</p>{{/SE_MENOR}}
<h3>DO OBJETO DO CONTRATO</h3>
<p><b>Cláusula 1ª.</b> Este contrato tem como OBJETO o uso da academia aquática, de propriedade da CONTRATADA, pelo CONTRATANTE para realização de atividade física de {{ATIVIDADE}} nos dias de {{DIAS_AULA}} no(s) seguinte(s) horário(s): das {{HORARIO}}h.</p>
<h3>DO FUNCIONAMENTO</h3>
<p><b>Cláusula 2ª.</b> A academia funcionará às {{DIAS_AULA}}, das 06h às 12h e das 14h às 20h30min, podendo haver alterações conforme necessidade da CONTRATADA.</p>
<p><b>Cláusula 3ª.</b> A CONTRATANTE poderá frequentar as instalações apenas nos dias e horários matriculados. A academia não se responsabiliza por objetos de valor deixados no local.</p>
<p><b>PARÁGRAFO ÚNICO:</b> A ACADEMIA NÃO SE RESPONSABILIZA POR OBJETOS DE VALORES SEJA DE QUAL FOR À NATUREZA TRAZIDA PARA AULAS NAS BOLSAS DOS ALUNOS. Coloquem seus pertences em lugares de maior visibilidade próxima a área da piscina.</p>
<h3>DA MATRÍCULA E DO PAGAMENTO DAS MENSALIDADES</h3>
<p><b>Cláusula 4ª.</b> A matrícula deve ser realizada presencialmente ou online pelo WhatsApp mediante apresentação de documentos pessoais.</p>
<p><b>1º PARÁGRAFO:</b> O(A) ALUNO(A) se compromete a manter o pagamento das mensalidades durante todo o período de 12 (doze) meses, independentemente da sazonalidade, incluindo os meses de inverno e demais períodos em que eventualmente não compareça às aulas.</p>
<p>O pagamento integral do período contratado é imprescindível para a manutenção da estrutura, salários dos funcionários, manutenção da piscina e continuidade dos serviços oferecidos pela academia.</p>
<p>Caso o(a) ALUNO(A) cumpra integralmente o contrato sem cancelamento, terá direito à renovação automática por mais 12 (doze) meses, mantendo o mesmo valor da mensalidade contratada, sem reajustes, até que seja informado antecipadamente pela direção o reajuste.</p>
<p><b>Cláusula 5ª.</b> O pagamento das mensalidades será feito por boleto bancário. Após o vencimento, incidirão juros e multas, sendo concedido um prazo de 5 dias de carência para aulas.</p>
<p><b>Cláusula 6ª.</b> O não pagamento da mensalidade no prazo de até 10 (Dez) dias após o vencimento resulta na inclusão do nome do(a) CONTRATANTE nos órgãos de proteção ao crédito (SPC/SERASA) e no protesto do título.</p>
<p>O sistema registra até 03 (três) meses de mensalidades em atraso; após esse período, os débitos permanecerão ativos e pendentes nos registros da academia, da instituição bancária e nos órgãos de proteção ao crédito.</p>
<h3>DO EXAME DE PELE</h3>
<p><b>Cláusula 7ª.</b> O exame preventivo de pele é obrigatório e realizado trimestralmente.</p>
<h3>DO VALOR DA MENSALIDADE</h3>
<p><b>Cláusula 8ª.</b> O CONTRATANTE pagará o valor mensal de {{MENSALIDADE}} ({{MENSALIDADE_EXTENSO}}), através de boleto bancário conforme vencimento descriminado no mesmo.</p>
<p><b>1º PARÁGRAFO:</b> O não cumprimento do (a) CONTRATANTE às aulas (como faltas) não o exime da obrigação de efetuar o pagamento das mensalidades, tendo em vista os serviços colocados à sua disposição, nos termos desta cláusula.</p>
<h3>DO CANCELAMENTO</h3>
<p><b>Cláusula 9ª.</b> O cancelamento deverá ser solicitado presencialmente ou por meio online oficial da CONTRATADA, exclusivamente no dia do vencimento da mensalidade, mediante quitação integral do boleto vigente.</p>
<p><b>Cláusula 10ª.</b> Em caso de cancelamento, será cobrada taxa de quebra contratual no valor de R$ 20,00 (vinte reais), referente a custos administrativos e baixas bancárias.</p>
<p><b>Cláusula 11ª.</b> A CONTRATADA poderá rescindir o contrato, de forma imediata, em caso de descumprimento das normas internas da academia ou desrespeito aos seus colaboradores, sem prejuízo da cobrança dos valores devidos.</p>
<h3>MATERIAL PESSOAL PARA AS AULAS</h3>
<p><b>Cláusula 12ª.</b> São permitidos apenas maiô, macaquito, sungão, sunga, touca e camisa UV. O uso de bermudas, biquínis, shorts ou maiôs transparentes é proibido.</p>
<h3>DO PRAZO CONTRATUAL</h3>
<p><b>Cláusula 13ª.</b> O contrato tem duração de 12 meses ininterrupto, sendo renovado automaticamente na primeira semana de outubro de cada ano, salvo manifestação contrária de ambas as partes.</p>
<p><b>Cláusula 14ª.</b> O cancelamento pode ser realizado a qualquer tempo, desde que respeitadas as regras de pagamentos e taxas.</p>
<h3>DA INADIMPLÊNCIA E NEGATIVAÇÃO</h3>
<p><b>Cláusula 15ª.</b> O não pagamento da mensalidade até a data do vencimento caracterizará inadimplência.</p>
<p><b>§ 1º.</b> Após 10 (dez) dias corridos de atraso, o nome do(a) CONTRATANTE e/ou responsável financeiro poderá ser encaminhado aos órgãos de proteção ao crédito (SPC, Serasa ou similares), independentemente de aviso prévio.</p>
<p><b>§ 2º.</b> O(a) CONTRATANTE declara estar ciente de que os sistemas financeiros e bancários utilizados pela CONTRATADA se alimentam automaticamente por um período de até 03 (três) meses de mensalidades em aberto.</p>
<p><b>§ 3º.</b> Após esse período, os boletos em aberto serão automaticamente negativados, não sendo possível a exclusão da restrição sem a quitação integral do débito.</p>
<p><b>§ 4º.</b> A inadimplência implicará, ainda, na suspensão imediata das aulas e, persistindo o débito, na exclusão do(a) aluno(a) da turma na qual se matriculou, sem prejuízo da cobrança dos valores devidos.</p>
<h3>DO FORO</h3>
<p><b>Cláusula 16ª.</b> As partes elegem o foro da comarca de Caruaru-PE para dirimir quaisquer controvérsias oriundas deste contrato.</p>
<p>Por estarem assim justos e contratados, firmamo-nos o presente instrumento, em duas vias de igual teor, juntamente com 02(duas) testemunhas idôneas, rubricando todas as suas páginas.</p>
{{ASSINATURAS}}`;

const CONDICOES_MATRICULA = `<h3>CONDIÇÕES DA MATRÍCULA – CIÊNCIA DO(A) ALUNO(A) OU RESPONSÁVEL</h3>
<ol>
<li>Em caso de desistência, o(a) aluno(a) ou responsável deverá comunicar formalmente a Secretaria e solicitar o cancelamento. A simples ausência às aulas não caracteriza cancelamento, permanecendo devidos os valores até a efetiva baixa da matrícula.</li>
<li>Sendo o(a) aluno(a) menor de idade, o responsável legal assume integral responsabilidade pelas obrigações decorrentes da matrícula, inclusive financeiras.</li>
<li>O valor da matrícula não corresponde à mensalidade, destinando-se à formalização e garantia da vaga.</li>
<li>O cancelamento solicitado em até 03 (três) dias corridos da matrícula dará direito à restituição de 60% do valor pago pela matrícula.</li>
<li>O cancelamento deverá ser formalizado junto à Secretaria, com a quitação dos valores eventualmente devidos e da taxa de quebra contratual, na data do vencimento do aluno não podendo passar da mencionada data.</li>
<li>A inadimplência sujeitará o(a) contratante à cobrança dos valores devidos, acrescidos dos encargos previstos, podendo o débito, observados os requisitos legais, ser encaminhado para protesto e/ou inscrição nos cadastros de proteção ao crédito (SPC/SERASA).</li>
<li>O atraso superior a 05 (cinco) dias poderá acarretar a suspensão da participação nas aulas até a regularização do pagamento.</li>
<li>Mensalidades pagas após o vencimento estarão sujeitas à multa, juros e demais encargos previstos no documento de cobrança, além das medidas legais cabíveis.</li>
<li>Para participação nas atividades aquáticas, é obrigatório o exame preventivo de pele, com periodicidade trimestral. A não apresentação poderá acarretar a suspensão temporária das aulas até a regularização.</li>
</ol>
<p><b>DECLARO ESTAR CIENTE E DE ACORDO COM AS CONDIÇÕES ACIMA.</b></p>`;

module.exports = { MODELO_CONTRATO, CONDICOES_MATRICULA };
