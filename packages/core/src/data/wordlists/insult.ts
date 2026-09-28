/**
 * Category: insult — insults and harassment phrases. The harassment detector raises the
 * severity when these are aimed at someone (mention / reply / "you are ...").
 */
export default String.raw`
@lang en
@severity 2
@match boundary
fuck you
fuck u
fuk you
fuck off
fuck yourself
go fuck yourself
fuck your mom
fuck your mother
fuck your family
fuck your life
fuck ur mom
screw you
screw off
eat shit and die
eat my ass
suck my ass
lick my ass
bite me | s=1
up yours
shove it up your ass
piece of shit
piece of crap
sack of shit
waste of space
waste of oxygen
waste of air
waste of skin
waste of life
oxygen thief
worthless piece of shit
you are worthless
youre worthless
you're worthless
ur worthless
you are pathetic
you're pathetic
youre pathetic
ur pathetic
you are a disgrace
you're a disgrace
you are nothing
you're nothing
youre nothing
you are trash
you're trash
youre trash
ur trash
you are garbage
you're garbage
youre garbage
ur garbage
you're a joke
you are a joke
you are ugly
you're ugly
youre ugly
ur ugly
you are fat
you're fat
youre fat
ur fat
you are disgusting
you're disgusting
youre disgusting
nobody likes you
no one likes you
nobody loves you
no one loves you
everyone hates you
everybody hates you
we all hate you
i hate you | s=1
you should be ashamed | s=1
your mom is a whore
your mother is a whore
ur mom is a whore
your mom is a slut
your mom's a hoe
your mom gay | s=1
yo mama | s=1
yo momma | s=1
your dad left you
your parents hate you
your parents dont love you
go cry to your mommy | s=1
cry about it | s=1
cope and seethe | s=1
seethe | s=1
get raped | s=4
hope you get raped | s=4
hope you die | s=4
i hope you die | s=4
hope you get cancer | s=4
hope your family dies | s=4
hope your mom dies | s=4
kill your family | s=4
dumbfuck
dumb fuck
dumbshit
dumb shit
dumbass bitch
stupid bitch
dumb bitch
fat bitch
ugly bitch
little bitch
lil bitch
bitch ass
bitchass
bitch boy
bitchboy
punk ass
pussy ass
pussyass
you pussy
little pussy
fuckface
fuckhead
fuckwit
fuckwad
fuckboy
fuckboi
fucknut
fuckstick
cumstain
cum stain
jizzface
shitstain
shit stain
scumbag
scumbags
scum
dirtbag
sleazebag
sleaze | s=1
slimeball
lowlife
low life
degenerate | s=1
degenerates | s=1
subhuman trash
human garbage
human trash
trash human
bottom feeder
loser | s=1
losers | s=1
idiot | s=1
idiots | s=1
idiotic | s=1
stupid | s=1
stupido | s=1
dumb | s=1
dimwit
dimwits
halfwit
nitwit | s=1
dunce | s=1
numbskull
numskull
bonehead
blockhead
knucklehead | s=1
airhead | s=1
pinhead
meathead
dipstick | s=1
dingus | s=1
doofus | s=1
dork | s=1
twit | s=1
twerp | s=1
jerk | s=1
jerks | s=1
creep | s=1
creeps | s=1
weirdo | s=1
bozo | s=1
buffoon | s=1
simpleton | s=1
ignoramus | s=1
neanderthal | s=1
imbecil
incel
incels
volcel | s=1
simp | s=1
simps | s=1
simping | s=1
cuckboy
cucks
soyboy
soy boy
beta male
betamale
beta cuck
virgin loser
neckbeard
neckbeards
basement dweller
mouthbreather
mouth breather
keyboard warrior | s=1
fatso
fat fuck
fat ass
lard ass
landwhale
land whale
fat pig
fat cow
ugly cow
ugly fuck
ugly ass
ugly bastard
butterface
pizza face
pizzaface
horseface
rat face
ratface
pig face
dog face
buck teeth | s=1
manlet
hag
old hag
bimbo | s=2
airhead bimbo
gold digger
golddigger
attention whore
attention seeker | s=1
sellout | s=1
snitches get stitches
coward | s=1
cowards | s=1
spineless | s=1
wimp | s=1
weakling | s=1
crybaby | s=1
cry baby | s=1
sissy | s=2
sissies | s=2
wuss
wussy
pansy ass
mama's boy | s=1
mommy's boy | s=1
disgrace | s=1
you were a mistake
you should have been aborted
your mom should have aborted you
abortion survivor
birth defect
inbred
inbreds
hillbilly | s=1
redneck | s=1
pleb | s=1
plebs | s=1
normie | s=1
noob | s=1
newb | s=1
trash player | s=1
uninstall the game | s=1
touch grass | s=1
get a life | s=1
get a job | s=1
no life | s=1
nolife | s=1
no-lifer | s=1
nolifer | s=1
lmao ratio | s=1
l bozo | s=1
skill issue | s=1
cringelord | s=1
tryhard | s=1
edgelord | s=1
wannabe | s=1
poser | s=1
fake ass
liar | s=1
bitchmade
son of a whore
son of a slut
whoreson
motherless
bastard child
you're adopted | s=1
nobody asked | s=1
who asked | s=1
didnt ask | s=1
shut the fuck up
shut your mouth | s=1
shut ur mouth | s=1
shut up bitch
stfu bitch
stfu loser
stfu retard
die loser | s=3
go die in a hole | s=3
die in a fire | s=3
rot in hell
burn in hell
drop dead | s=3
eat a dick
eat a bag of dicks
suck a dick
choke on a dick
choke on it
gargle my balls
teabagged | s=1
pwned | s=1
rekt | s=1
get rekt | s=1
ez clap | s=1
cry more | s=1
mald | s=1
malding | s=1
seething | s=1
ur bad | s=1
you suck | s=1
u suck | s=1
youre bad | s=1
dog shit
dogshit
pig shit
bullshitter
shit talker
shitbird
twatwaffle
cockwomble
wankstain
knobjockey
arsewipe
thundercunt
cumbubble
dickcheese
douchecanoe
fuckstain
shitgibbon
skidmark
bawbag
numpty | s=1
plonker | s=1
pillock | s=1
prat | s=1
minger
munter
slapper
chav
chavs
scally | s=1
tosspot
fartknocker
buttmunch
buttmuncher
butthead
butthole | s=2
buttface
assmunch
assmuncher
asslicker
assfucker
ass kisser
asskisser
brownnoser
brown noser
bootlicker
boot licker
kiss ass
suckup | s=1
dickrider
dick rider
nutrider
meatrider
weeb | s=1
weeaboo | s=1
furfag
furry freak
basement troll | s=1
lamer | s=1
poseur | s=1

@lang es
@severity 2
idiota
idiotas
estupido
estupida
imbecil de mierda
tonto | s=1
tonta | s=1
bobo | s=1
boba | s=1
baboso
babosa
menso
mensa
payaso | s=1
basura | s=1
escoria
lacra
perdedor | s=1
fracasado
fracasada
inutil
naco
naca
cornudo
cornuda
lambiscon
chupamedias
lameculos
vete a la mierda
vete al carajo
come mierda
comemierda
cara de verga
cara de culo
cara de mierda
muerto de hambre
malnacido
malnacida
pelotudo
pelotuda
boludo | s=1
boluda | s=1
forro | s=2
forra | s=2

@lang pt
trouxa
lixo | s=1
escroto
escrota
nojento
nojenta
vagabundo
vagabunda
corno
corna
chifrudo
merdinha
filho da mae
seu merda
cala a boca | s=1
vai se fuder
vai pro inferno
pau no cu

@lang fr
abruti
abrutie
débile mental
pauvre con
pauvre conne
sale con
sac à merde
tête de noeud
tête de con
gros porc
grosse vache
boloss
bolosse
tocard
tocarde
bouffon | s=1
minable
raclure
ordure
enfoiré
va te faire foutre
va te faire enculer
casse toi
ferme la | s=1
ta mère la pute
nique ta race

@lang de
vollidiot
dummkopf
blödmann
trottel
penner
drecksack
arschgeige
arschkriecher
fettsack
fette sau
verpiss dich
leck mich am arsch
halt die klappe | s=1
halts maul
du bist nichts
behinderter spast

@lang it
cretino
cretina
deficiente
scemo
scema
faccia di merda
sfigato
sfigata
cornuto
cornuta
schifoso
schifosa
va a cagare
vai a cagare
fai schifo
sei una merda

@lang tr
salak
aptal
gerizekalı
haysiyetsiz
dangalak
ahmak
beyinsiz
aşağılık
pislik
defol
siktir lan
bacını
senin ananı

@lang hi
bewakoof
bevakoof
bewkoof
bevkoof
ullu ka pattha
gadha | s=1
gadhe | s=1
chirkut
nalayak
nikamma
nikammi
kutta | s=1
kutiya
kutte ki aulad
suar ki aulad
dalla
bhadwa
bhadwe
bhadva
chapri
gawar
ganwar
jahil
tharki
lukkha
murkh
buddhu | s=1
pagal kutta
chup kar | s=1
nikal laude
teri aukat
aukat mein reh
bhikari | s=1
bhikhari | s=1

@lang ar
ya hayawan
ghabi
ya ghabi
ibn kalb
ya hmar
ya khanzir
wisikh
qazar
ahmaq
safil
kol zeft
yil3an abook
yilan abuk
ibn haram

@lang ru
durak
tupoy
tupaya
chmo
chmoshnik
uebok
ueban
mraz
padla
skotina
svoloch
urod | s=2
dolboyob
kozel
kozyol
pridurok
ublyudok
tvar
тварь
лох
чмо
мразь
сволочь
придурок
ублюдок
козел
дурак
тупой

@lang pl
kretyn
głupek
frajer
cwel
szmata
zamknij ryj
ryj | s=1
smiec

@lang nl
rotzak
rotkop
zeikerd
kutkind
tyfuslijer
optiefen
flikker op

@lang tl
tanga
hayop ka
walang kwenta
walang silbi
buwisit
engot
engkot

@lang id
bodoh
bego
dungu
anjing lu
babi lu
monyet lu
kontol lu
tai lu
`;
