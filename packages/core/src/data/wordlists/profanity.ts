/**
 * Category: profanity — general swearing. Disabled by default (many communities allow it).
 * Format: see packages/core/src/wordlist/parse.ts. Validate with `pnpm wordlist:validate`.
 */
export default String.raw`
@lang en
@severity 2
@match substring
fuck
fvck
phuck
fuk
fck
@match boundary
fuq
fux
fcking
fking
fkin
fkn
effing
eff off
mofo
mf
mfer
mfker
muthafucka
muthafucker
mothafucka
shit
shits
shitty
shitting
shitted
shitter
shite
shyt
sheeit
bullshit
horseshit
dipshit
batshit
apeshit
chickenshit
shitload
shitstorm
shitshow
shithole
shitface
shitfaced
shitbag
shithead
shitlord
shitpost
shitposting
holy shit
no shit
tough shit
eat shit
@match substring
bitch
@match boundary
biatch
biotch
betch
beyotch
bish
@severity 1
damn
damnit
dammit
goddamn
goddamnit
god damn
crap
crappy
crapped
crapping
bloody hell
hell no
what the hell
go to hell
bugger
bugger off
buggered
bollocks
bollox
arse
arsed
bloody
sod off
piss off
pissed
pissed off
pissing
pisses
piss
wtf
wth
stfu
gtfo
omfg
fml
jfc
ffs
@severity 2
ass
asses
asshole
assholes
arsehole
arseholes
asshat
asswipe
assclown
asshead
assface
jackass
dumbass
fatass
smartass
lardass
kissass
kiss my ass
badass | s=1
hardass
@match substring
motherfucker
@match boundary
bastard
bastards
bastardo
prick
pricks
dick
dicks
dickhead
dickheads
dickface
dickwad
dickweed
dickbag
dickish
cock
cocks
knobhead
knobend
bellend
twat
twats
twatty
wanker
wankers
wank
wanking
tosser
tossers
douche
douchebag
douchebags
douchey
turd
turds
@severity 3
cunt
cunts
cunty
cuntish
@match substring
cuntface
@match boundary
son of a bitch
sonofabitch
@match substring

@lang es
@match boundary
@severity 2
mierda
puta madre
hijo de puta
hijoputa
hdp
joder
jodete
jodido
cabron
cabrona
cabrones
chingar
chingada
chingado
chinga tu madre
chingate
pendejo
pendeja
pendejos
pendejada
verga
vergazo
culero
culera
carajo
me cago en
mamada
mamadas
pinche | s=1
gilipollas
capullo
malparido
malparida
hijueputa
huevon
huevona
weon
conchetumare
concha tu madre
la concha de tu madre

@lang pt
caralho
porra | s=1
merda
foda-se
fodase
foder
fodido
puta que pariu
filho da puta
fdp
arrombado
arrombada
desgraçado
desgraçada
cacete
bosta
cuzao
babaca
otario
vai se foder
vai tomar no cu
vtnc
pqp

@lang fr
merde
putain
putain de merde
bordel de merde
connard
connards
connasse
salaud
salope
enculé
enculer
nique ta mere
ntm
fils de pute
ta gueule
ferme ta gueule
batard
couilles
chiasse
emmerdeur

@lang de
scheiße
scheisse
scheiss
scheißdreck
verdammt | s=1
verdammte scheiße
arsch
arschloch
arschlöcher
wichser
fick dich
fick
ficken
gefickt
hurensohn
hurensöhne
fotze
schlampe
drecksau
dreckskerl
leck mich
halt die fresse
missgeburt
pisser
kacke | s=1
kackbratze

@lang it
cazzo
cazzi
vaffanculo
fanculo
stronzo
stronza
stronzi
puttana
porca puttana
porca miseria | s=1
minchia
coglione
coglioni
figa
troia
mannaggia | s=1
pezzo di merda
testa di cazzo
figlio di puttana
succhiacazzi

@lang tr
amk
amına koyayım
amina koyim
aminakoyim
amcık
orospu
orospu cocugu
siktir
siktir git
sikerim
sikeyim
sikim
yarrak
pezevenk
kahpe
gavat
yavşak
serefsiz
ananı
ananı sikeyim
amına

@lang hi
madarchod
maderchod
madarjaat
behenchod
bhenchod
benchod
bhencho
chutiya
chutiye
chutia
chutiyapa
chootiya
bhosdike
bhosadike
bhosdiwale
bhosdi
bhosda
gaand
gaandu
gand mara
randi
randwa
harami
haramkhor
haramzada
haramzadi
lauda
lavda
lawda
lund
lodu
loda
chod
chodu
bsdk
teri maa ki
maa ki chut
teri maa ki chut
teri behen ki
jhaat
jhatu
jhantu
tatti | s=1
chinal
kamina | s=1
kamine | s=1
kaminey | s=1
kutte | s=1
kutti | s=1
suar | s=1
bakchod
bakchodi
chodna

@lang ar
sharmouta
sharmoota
sharmuta
charmouta
ibn el sharmouta
kos omak
kus ummak
kosomak
kus emmak
zebi
zobi
zeby
ayri
ayre
khara
ya kalb
ya ibn el kalb
manyak
manyouk
ahbal
hmar | s=1
tizak
teezak
kol khara
nayek

@lang ru
suka
cyka
blyat
blyad
bljad
pizdec
pizdets
pizda
nahui
nahuy
na hui
khuy
huinya
ebat
yebat
yob tvoyu mat
eb tvoyu mat
ebanyi
yobany
mudak
mudila
govno
zalupa
shlyukha
blya
блять
блядь
пиздец
пизда
хуй
нахуй
ебать
мудак
говно

@lang pl
kurwa
kurwy
chuj
chujowy
huj
pierdole
pierdolić
pierdolony
spierdalaj
wypierdalaj
jebac
jebany
skurwysyn
skurwiel
zjeb
dupek
cipa

@lang nl
kut
kutwijf
godverdomme
godverdomne
klootzak
tering
kanker
kankerlijer
teringlijer
tyfus
hoer
hoerenzoon
kankerhoer
eikel | s=1
sukkel | s=1
kutzooi

@lang tl
putang ina
putangina
tangina
tang ina
puta ka
gago
tarantado
ulol
pakyu
pakshet
punyeta
hindot
kupal
bwisit | s=1

@lang id
bangsat
bajingan
kontol
memek
ngentot
jancok
jancuk
dancok
anjing | s=1
anjir | s=1
tolol
goblok
kampret
pukimak
puki mak
lonte
brengsek
`;
