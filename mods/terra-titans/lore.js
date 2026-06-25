// Terra Titans — Character lore (English).
//
// Factual, respectful biographies of 16 historical leaders, framed for the board game.
// Shape matches what App.js's showLoreModal + character-ai.js read:
//   nameZh, titleZh (header lines), identity, alignment, background, noticed (optional),
//   joining, styleIntro, style[] (required array), styleOutro, relationships[] (required
//   array of {target, description}), themeSummary (required string).
// SENSITIVITY GUARDRAILS (design vet): Wu Zetian = administrator/statecraft (not
// intrigue/deceit); Genghis/Suleiman/Moctezuma/Cyrus = builders/patrons/lawgivers; Mansa
// Musa = patron of trade & learning; no national flags, state emblems, or religious
// iconography in the prose. The markdown originals live in ./lore/*.md.

export const CHARACTER_LORE = {
  'hammurabi': {
    nameZh: 'The Lawgiver',
    titleZh: 'King of Babylon',
    identity: 'Ruler of Old Babylon, Mesopotamia',
    alignment: 'Order / Law / Codified rule',
    background: `Hammurabi ruled Babylon in the eighteenth century BCE, expanding a modest city-state into the dominant power of southern Mesopotamia. He is remembered above all for one of the earliest extensive written law codes, inscribed on a tall stone stele so that its rules stood in public view.

His code set out fixed penalties, contract terms, wages, and protections — an attempt to make obligations predictable rather than arbitrary. Whatever its harshness by modern standards, it framed law as something written down, knowable, and applied to ruler and subject alike.`,
    joining: `On the board, Hammurabi treats property as jurisdiction. He is at his best when he can fix the rules of a place and make others pay to abide by them — patient, methodical, and unmoved by short-term swings.`,
    styleIntro: 'Hammurabi governs by three principles:',
    style: [
      'A written rule is worth more than a spoken favor',
      'Predictable obligations are the foundation of wealth',
      'Authority that cannot be enforced is no authority at all',
    ],
    styleOutro: 'He rarely chases the flashiest deal. He waits, codifies, and collects.',
    relationships: [
      { target: 'Genghis Khan', description: 'Both extract tribute, but Hammurabi prefers the written claim to the open road' },
      { target: 'Cyrus the Great', description: 'Mutual respect between a lawgiver and a tolerant administrator' },
      { target: 'Wu Zetian', description: 'Two rulers who trust process over improvisation' },
    ],
    themeSummary: 'Carve the rule in stone,\nand let everyone read what they owe.',
  },

  'cyrus-the-great': {
    nameZh: 'King of Kings',
    titleZh: 'Founder of the Achaemenid Empire',
    identity: 'Founder of the first Persian Empire',
    alignment: 'Tolerance / Administration / Stability',
    background: `Cyrus the Great founded the Achaemenid Empire in the sixth century BCE, uniting a vast territory stretching across much of West Asia. He is remembered less for conquest than for how he governed what he won.

Cyrus allowed conquered peoples to keep their customs and local administration rather than imposing a single uniform order. This pragmatic tolerance made his empire unusually durable and earned him a reputation, across many later traditions, as a model of restrained and fair rule.`,
    joining: `On the board, Cyrus buys low and absorbs shocks. His tolerant, administrative instincts translate into cheaper acquisitions and a steady hand when bad news lands.`,
    styleIntro: 'Cyrus rules by three habits:',
    style: [
      'Let others keep their customs, and they will keep paying',
      'A bargain secured quietly outlasts a victory won loudly',
      'Reserves matter most on the day the market turns',
    ],
    styleOutro: 'He expands by accumulation, not upheaval — and weathers the storms that ruin bolder players.',
    relationships: [
      { target: 'Hammurabi', description: 'A lawgiver and an administrator who respect each other across the ages' },
      { target: 'Alexander the Great', description: 'Alexander admired and inherited much of what Cyrus built' },
      { target: 'Mansa Musa', description: 'Two patrons who understand that wealth is best spent wisely' },
    ],
    themeSummary: 'Win the land,\nthen let the people keep their own way home.',
  },

  'chandragupta-maurya': {
    nameZh: 'Empire-Founder',
    titleZh: 'Founder of the Maurya Empire',
    identity: 'First emperor of the Maurya dynasty, India',
    alignment: 'Foundation / Growth / Administration',
    background: `Chandragupta Maurya founded the Maurya Empire in the late fourth century BCE, unifying much of the Indian subcontinent for the first time under a single administration. Working with the strategist Kautilya, he built a centralized state with a structured bureaucracy, tax system, and standing army.

His reign laid the groundwork for one of antiquity's largest and best-organized empires, prizing steady institutional growth over momentary triumph.`,
    joining: `On the board, Chandragupta compounds. A reliable bonus each lap funds his next expansion, rewarding circulation and patience over any single big swing.`,
    styleIntro: 'Chandragupta builds by three rules:',
    style: [
      'Every completed circuit should pay for the next',
      'Institutions outlast the rulers who found them',
      'Steady revenue beats a lucky windfall',
    ],
    styleOutro: 'He prospers by keeping in motion — each lap a little richer than the last.',
    relationships: [
      { target: 'Mansa Musa', description: 'Both grow stronger the more they travel and the more they give' },
      { target: 'Qin Shi Huang', description: 'Two empire-builders who organized vast lands under one system' },
      { target: 'Cyrus the Great', description: 'Founders who valued durable administration over raw conquest' },
    ],
    themeSummary: 'Found the system once,\nand let it pay you forever.',
  },

  'qin-shi-huang': {
    nameZh: 'First Emperor',
    titleZh: 'Unifier of China',
    identity: 'First emperor of a unified China',
    alignment: 'Construction / Standardization / Scale',
    background: `Qin Shi Huang unified the warring states of China in 221 BCE, becoming its first emperor. He standardized writing, currency, weights, and even axle widths across the realm, and connected and extended great defensive walls along the northern frontier.

His reign is remembered for monumental construction on an unprecedented scale — projects that demanded enormous resources but reshaped the land for centuries.`,
    joining: `On the board, Qin builds big and builds cheap. Reduced upgrade costs let him stack structures faster than rivals, turning territory into towers.`,
    styleIntro: 'Qin governs by three convictions:',
    style: [
      'Standardize everything, and everything becomes buildable',
      'Monuments outlast the hands that raised them',
      'Scale, applied early, compounds into dominance',
    ],
    styleOutro: 'He plays for the long, vertical game: fewer plots, taller than anyone else can afford.',
    relationships: [
      { target: 'Suleiman the Magnificent', description: 'Two patrons of monumental construction at the height of their states' },
      { target: 'Pachacuti', description: 'Master builders who reshaped the land itself' },
      { target: 'Chandragupta Maurya', description: 'Fellow unifiers who organized vast territory under one rule' },
    ],
    themeSummary: 'Make the standard,\nthen build higher than the standard allows.',
  },

  'wu-zetian': {
    nameZh: 'The Only Empress',
    titleZh: 'Empress Regnant of China',
    identity: "China's only reigning empress in her own name",
    alignment: 'Statecraft / Administration / Talent',
    background: `Wu Zetian rose to become the only woman in Chinese history to rule as emperor in her own right, governing in the late seventh and early eighth centuries. She is recognized as a capable and reform-minded administrator.

She expanded the civil-service examination system, promoting officials on merit rather than birth, and oversaw a period of competent government and stability. Her record is one of skilled statecraft and institutional reform.`,
    joining: `On the board, Wu Zetian governs by information. She reads the next event before it arrives and keeps her true position discreet at the negotiating table — pure administrative foresight, never deceit.`,
    styleIntro: 'Wu Zetian leads by three administrative habits:',
    style: [
      'Promote on merit, and the able will serve you',
      'Know what is coming before your rivals do',
      'A quiet ledger is a strong ledger',
    ],
    styleOutro: 'She wins by preparation and good judgment — informed, measured, and never caught off guard.',
    relationships: [
      { target: 'Hammurabi', description: 'Two rulers who trust written process over improvisation' },
      { target: 'Taejo of Joseon', description: 'Both reformed how a state selects and rewards its servants' },
      { target: 'Cyrus the Great', description: 'Administrators who valued capable governance above spectacle' },
    ],
    themeSummary: 'Govern by merit and foresight,\nand the realm runs itself.',
  },

  'alexander-the-great': {
    nameZh: 'World-Conqueror',
    titleZh: 'King of Macedon',
    identity: 'King of Macedon and conqueror of an empire',
    alignment: 'Momentum / Conquest / Boldness',
    background: `Alexander of Macedon, tutored as a youth by Aristotle, built one of the largest empires of the ancient world before the age of thirty-three. His campaigns carried him from Greece across Egypt and Persia to the edge of India.

Famed for relentless speed and tactical daring, he rarely paused once a campaign began. The cities he founded and the cultural exchange that followed his marches shaped the Hellenistic world for centuries.`,
    joining: `On the board, Alexander thrives on others' collapse. Each bankruptcy fills his coffers, and his rebuilds come cheap — while his sheer stamina lets him press on when a roll falls short.`,
    styleIntro: 'Alexander campaigns by three rules:',
    style: [
      'Never stop while there is ground ahead',
      'A rival who falls is a windfall, not a tragedy',
      'Press the advantage before the moment closes',
    ],
    styleOutro: 'He plays fast and forward, turning every collapse around him into fuel for the next advance.',
    relationships: [
      { target: 'Cyrus the Great', description: 'Alexander admired Cyrus and inherited much of what he built' },
      { target: 'Julius Caesar', description: 'Two conquerors who profited from the wreckage of their rivals' },
      { target: 'Genghis Khan', description: 'Restless commanders who measured success in distance covered' },
    ],
    themeSummary: 'Keep marching,\nand let the fallen pay for the road ahead.',
  },

  'julius-caesar': {
    nameZh: 'Dictator Perpetuo',
    titleZh: 'Roman General and Statesman',
    identity: 'Roman general, statesman, and dictator',
    alignment: 'Opportunism / Conquest / Reform',
    background: `Julius Caesar was a Roman general and statesman whose campaigns in Gaul and decisive role in the civil wars of the first century BCE transformed the Roman Republic. He reformed the calendar, reorganized debt and provincial administration, and concentrated power in his own hands.

A brilliant commander and a shrewd politician, he excelled at turning crisis and the failures of his opponents into personal advantage.`,
    joining: `On the board, Caesar profits from chaos. Every bankruptcy among his rivals lines his treasury, and his rebuilds cost less — he is strongest exactly when others fall.`,
    styleIntro: 'Caesar maneuvers by three principles:',
    style: [
      "A rival's ruin is your opportunity",
      'Reform the rules while everyone is distracted',
      'Rebuild faster and cheaper than your enemies can recover',
    ],
    styleOutro: 'He waits for the board to crack, then turns every collapse into a foothold.',
    relationships: [
      { target: 'Alexander the Great', description: 'Caesar measured himself against Alexander and shared his appetite for advantage' },
      { target: 'Cleopatra VII', description: 'Famous allies whose interests aligned at a pivotal moment' },
      { target: 'Suleiman the Magnificent', description: 'Two reformers who reshaped the institutions of vast states' },
    ],
    themeSummary: 'When the board breaks,\ngather the spoils.',
  },

  'mansa-musa': {
    nameZh: 'Lord of the Gold',
    titleZh: 'Emperor of Mali',
    identity: 'Ruler of the Mali Empire',
    alignment: 'Wealth / Patronage / Trade',
    background: `Mansa Musa ruled the Mali Empire in the early fourteenth century at the height of its wealth, drawn from control of gold and salt trade routes across West Africa. He is often cited as one of the richest individuals in recorded history.

His famous long-distance journey distributed so much gold along the way that it was remembered for generations. He invested heavily in cities, scholarship, and learning, turning Timbuktu into a renowned center of education and trade.`,
    joining: `On the board, Mansa Musa profits from movement. A bonus each lap reflects an inexhaustible treasury and a patron's instinct to keep wealth flowing rather than hoarding it.`,
    styleIntro: 'Mansa Musa prospers by three habits:',
    style: [
      'Wealth in motion does more than wealth at rest',
      'Patronage of learning pays dividends for generations',
      'Generosity, well aimed, buys lasting standing',
    ],
    styleOutro: 'He grows richer the more he circulates, funding the board even as he masters it.',
    relationships: [
      { target: 'Chandragupta Maurya', description: 'Both grow stronger the more they keep moving' },
      { target: 'Cyrus the Great', description: 'Patrons who believed wealth was meant to be spent wisely' },
      { target: 'Suleiman the Magnificent', description: 'Great patrons of cities, scholarship, and the arts' },
    ],
    themeSummary: 'Let the gold travel,\nand let learning follow it.',
  },

  'suleiman': {
    nameZh: 'The Magnificent',
    titleZh: 'Sultan of the Ottoman Empire',
    identity: 'Ottoman sultan at the empire\'s zenith',
    alignment: 'Patronage / Construction / Law',
    background: `Suleiman the Magnificent ruled the Ottoman Empire in the sixteenth century, presiding over its golden age. Known in his own lands as "the Lawgiver" for harmonizing and codifying its legal system, he was also a tremendous patron of architecture and the arts.

Under his patronage, master architects raised mosques, bridges, aqueducts, and public works across the empire, leaving a built legacy that still defines the skylines of its great cities.`,
    joining: `On the board, Suleiman builds grandly for less. Discounted upgrades let his patronage outpace rivals, turning held property into monumental development.`,
    styleIntro: 'Suleiman reigns by three convictions:',
    style: [
      'Good law and great building are two faces of one rule',
      'Patronage made permanent outlasts the patron',
      'Develop deeply where others merely hold',
    ],
    styleOutro: 'He turns ownership into architecture, raising more on each plot than his rivals can match.',
    relationships: [
      { target: 'Qin Shi Huang', description: 'Two patrons of monumental construction at the peak of their states' },
      { target: 'Mansa Musa', description: 'Great patrons of cities, scholarship, and the arts' },
      { target: 'Pachacuti', description: 'Builders whose works reshaped whole landscapes' },
    ],
    themeSummary: 'Codify the law,\nthen build something worthy of it.',
  },

  'genghis-khan': {
    nameZh: 'The Great Khan',
    titleZh: 'Founder of the Mongol Empire',
    identity: 'Founder and first Great Khan of the Mongol Empire',
    alignment: 'Tribute / Mobility / Organization',
    background: `Genghis Khan united the nomadic tribes of the steppe in the early thirteenth century and founded the largest contiguous land empire in history. Beyond his campaigns, he was an organizer: he established a written legal code, a relay communication network, and a meritocratic structure that promoted ability over birth.

His empire connected East and West, securing trade routes and the flow of goods, ideas, and tribute across Eurasia on a scale never seen before.`,
    joining: `On the board, Genghis collects tribute. He marks one holding as regulated and makes every rival who lands there pay a premium — control exercised through the roads and the toll.`,
    styleIntro: 'Genghis commands by three principles:',
    style: [
      'Promote by ability, and the able will follow you',
      'Hold the route, and the route pays you',
      'A single well-placed toll outearns a dozen small claims',
    ],
    styleOutro: 'He turns one key holding into a tollgate that drains every traveler who passes.',
    relationships: [
      { target: 'Hammurabi', description: 'Both impose a binding claim — one in stone, one on the road' },
      { target: 'Alexander the Great', description: 'Restless commanders who measured success in distance covered' },
      { target: 'Moctezuma I', description: 'Two rulers who built their power on systems of tribute' },
    ],
    themeSummary: 'Hold the crossing,\nand the world pays to pass.',
  },

  'taejo': {
    nameZh: 'Dynasty-Founder',
    titleZh: 'Founder of the Joseon Dynasty',
    identity: 'Founder and first king of Joseon, Korea',
    alignment: 'Foundation / Reform / Renewal',
    background: `Taejo founded the Joseon dynasty in 1392, which would rule Korea for over five centuries. A respected general before taking the throne, he carried out sweeping land reform, moved the capital, and established new administrative foundations for the state.

His founding reforms set the institutional course for one of the longest-lasting dynasties in East Asian history, prizing renewal and a fresh start over the entrenched order he replaced.`,
    joining: `On the board, Taejo refuses a bad hand. He re-draws an event card he dislikes and shrugs off lingering setbacks — a founder's instinct to reset and begin again on his own terms.`,
    styleIntro: 'Taejo founds by three rules:',
    style: [
      'A poor draw is not a verdict — reshuffle it',
      'Reform the foundation, and the rest follows',
      'A clean start beats a tainted inheritance',
    ],
    styleOutro: 'He bends fortune toward fresh ground, turning unlucky moments into second chances.',
    relationships: [
      { target: 'Wu Zetian', description: 'Both reformed how a state selects and rewards its servants' },
      { target: 'Chandragupta Maurya', description: 'Founders who built institutions meant to outlast them' },
      { target: 'Tokugawa Ieyasu', description: 'Two founders of enduring, long-ruling orders' },
    ],
    themeSummary: 'When the hand is poor,\nfound a better one.',
  },

  'tokugawa-ieyasu': {
    nameZh: 'The Patient Shogun',
    titleZh: 'Founder of the Tokugawa Shogunate',
    identity: 'First shogun of the Tokugawa shogunate, Japan',
    alignment: 'Patience / Stability / Reserves',
    background: `Tokugawa Ieyasu ended a long era of civil war in Japan and founded a shogunate that brought more than two and a half centuries of peace and stability. Famed for his patience, he waited out rivals over decades before consolidating power.

His settlement emphasized careful management, controlled exchange with the outside world, and the steady accumulation of reserves — a long peace built on caution rather than conquest.`,
    joining: `On the board, Tokugawa absorbs losses. His deep reserves blunt the worst financial setbacks, and he acquires a little cheaper than most — the patient player who is hardest to knock down.`,
    styleIntro: 'Tokugawa endures by three principles:',
    style: [
      'Reserves quietly built decide the long game',
      'A loss softened is a loss half avoided',
      'Patience outlasts boldness',
    ],
    styleOutro: 'He rarely wins the early sprint, but he is the last one standing when the storms pass.',
    relationships: [
      { target: 'Taejo of Joseon', description: 'Two founders of enduring, long-ruling orders' },
      { target: 'Cyrus the Great', description: 'Rulers who prized stability and durable administration' },
      { target: 'Mansa Musa', description: 'Both understood that reserves are strength held in waiting' },
    ],
    themeSummary: 'Wait, and keep your reserves —\nthe patient ruler outlasts the storm.',
  },

  'pachacuti': {
    nameZh: 'Earth-Shaker',
    titleZh: 'Sapa Inca of the Inca Empire',
    identity: 'Ruler who expanded the Inca Empire',
    alignment: 'Engineering / Expansion / Construction',
    background: `Pachacuti transformed a regional kingdom into the vast Inca Empire in the fifteenth century. He is credited with reorganizing the state and directing extraordinary feats of engineering: terraced agriculture across steep mountainsides, an immense road network, and monumental stone architecture.

The famed mountain estate of Machu Picchu is associated with his reign — a testament to Andean mastery of building in the most demanding terrain.`,
    joining: `On the board, Pachacuti builds where others cannot. Reduced upgrade costs reflect Andean engineering skill, letting him develop deeply and economically.`,
    styleIntro: 'Pachacuti builds by three convictions:',
    style: [
      'No terrain is too steep to terrace',
      'Roads and stone are the bones of an empire',
      'Build efficiently, and build to last',
    ],
    styleOutro: 'He turns difficult ground into developed value, raising more for less on every plot.',
    relationships: [
      { target: 'Qin Shi Huang', description: 'Master builders who reshaped the land itself' },
      { target: 'Suleiman the Magnificent', description: 'Builders whose works reshaped whole landscapes' },
      { target: 'Moctezuma I', description: 'Two great rulers of the pre-Columbian Americas' },
    ],
    themeSummary: 'Terrace the mountain,\nand build an empire on the slope.',
  },

  'moctezuma-i': {
    nameZh: 'Tribute-Master',
    titleZh: 'Ruler of the Aztec Empire',
    identity: 'Fifth ruler of the Aztec (Mexica) state',
    alignment: 'Tribute / Administration / Public works',
    background: `Moctezuma I ruled the Aztec state in the fifteenth century and greatly expanded its reach and organization. He is remembered as a capable administrator who systematized the tribute networks that sustained the empire and oversaw major public works.

Under his rule, the great causeways and an aqueduct were built to supply and protect the island capital of Tenochtitlan, and the tribute system was organized into a reliable instrument of statecraft.`,
    joining: `On the board, Moctezuma codifies tribute. He designates one holding as regulated, and rivals who land there pay the premium — power expressed through organized, predictable levy.`,
    styleIntro: 'Moctezuma rules by three principles:',
    style: [
      'An organized tribute is more reliable than a raid',
      'Public works secure the wealth they cost',
      'Mark the place that matters, and let it pay',
    ],
    styleOutro: 'He turns a single regulated holding into a steady, premium return.',
    relationships: [
      { target: 'Genghis Khan', description: 'Two rulers who built their power on systems of tribute' },
      { target: 'Pachacuti', description: 'Two great rulers of the pre-Columbian Americas' },
      { target: 'Hammurabi', description: 'Administrators who made obligations fixed and knowable' },
    ],
    themeSummary: 'Organize the tribute,\nand the empire sustains itself.',
  },

  'moshoeshoe-i': {
    nameZh: 'The Mountain King',
    titleZh: 'Founder of the Basotho Nation',
    identity: 'Founder and king of the Basotho people, Southern Africa',
    alignment: 'Diplomacy / Refuge / Negotiation',
    background: `Moshoeshoe I founded the Basotho nation in the early nineteenth century, gathering scattered communities into a kingdom amid a turbulent era. He is celebrated above all as a diplomat: he offered refuge to the displaced and preferred negotiation and clever statesmanship to open war.

Through skillful diplomacy he preserved his people's autonomy against far larger powers, building a reputation for wisdom, restraint, and the careful management of rivals.`,
    joining: `On the board, Moshoeshoe negotiates the toll down. He pays reduced rent when he lands on rivals' monopolies — a diplomat who never quite pays full price to those who hold the high ground.`,
    styleIntro: 'Moshoeshoe leads by three habits:',
    style: [
      'Talk first; fight only when talk fails',
      'Shelter the displaced, and they strengthen you',
      'A negotiated price is always lower than a demanded one',
    ],
    styleOutro: 'He survives among giants by paying less to cross their land than anyone expects.',
    relationships: [
      { target: 'Cleopatra VII', description: 'Two leaders who won with words what others sought by force' },
      { target: 'Cyrus the Great', description: 'Rulers known for tolerance and the careful handling of rivals' },
      { target: 'Genghis Khan', description: 'The toll-keeper and the negotiator who talks the toll down' },
    ],
    themeSummary: 'Win with words,\nand never pay the full toll.',
  },

  'cleopatra-vii': {
    nameZh: 'The Last Pharaoh',
    titleZh: 'Last Ruler of Ptolemaic Egypt',
    identity: 'Final active ruler of the Ptolemaic Kingdom of Egypt',
    alignment: 'Diplomacy / Negotiation / Influence',
    background: `Cleopatra VII was the last active ruler of Ptolemaic Egypt, a highly educated leader said to speak many languages. She is remembered as a formidable diplomat and political strategist who navigated the dominant power of Rome to defend her kingdom's interests.

For decades she preserved Egypt's standing through alliance and negotiation rather than force, making her one of antiquity's most skilled practitioners of diplomacy.`,
    joining: `On the board, Cleopatra negotiates every rent. Her diplomatic mastery cuts what she pays on rivals' monopolies — she crosses others' territory on favorable terms.`,
    styleIntro: 'Cleopatra leads by three principles:',
    style: [
      'Every meeting is a negotiation',
      'Alliance defends what arms cannot',
      'The skilled diplomat never pays the asking price',
    ],
    styleOutro: 'She turns charm and statecraft into a standing discount on everyone else\'s ground.',
    relationships: [
      { target: 'Julius Caesar', description: 'Famous allies whose interests aligned at a pivotal moment' },
      { target: 'Moshoeshoe I', description: 'Two leaders who won with words what others sought by force' },
      { target: 'Wu Zetian', description: 'Two highly capable women who governed through skill and statecraft' },
    ],
    themeSummary: 'Negotiate everything,\nand pay less to walk every road.',
  },
};

export function getLoreById(id) {
  return CHARACTER_LORE[id] || null;
}
