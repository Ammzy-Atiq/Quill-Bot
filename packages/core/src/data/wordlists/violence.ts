/**
 * Category: violence — threats of violence, doxxing threats, terror threats.
 * Generic gaming talk ("I'll kill you in this round") can trigger low-severity entries;
 * servers can disable individual terms or the category.
 */
export default String.raw`
@lang en
@severity 3
@match boundary
i will kill you
i'll kill you
ill kill you
im going to kill you
i'm going to kill you
i am going to kill you
im gonna kill you
i'm gonna kill you
imma kill you
gonna kill you | s=1
going to kill you | s=1
will kill you | s=1
kill you all
i will kill your family
ill kill your family
i'll kill your family
i will kill your mom
i will murder you
ill murder you
i'll murder you
im going to murder you
gonna murder you
i will find you
ill find you
i'll find you
i will find you and kill you
i will hunt you down
ill hunt you down
i'll hunt you down
hunt you down
i know where you live
we know where you live
i know your address
i have your address
got your address
i have your ip
i got your ip
i know your ip
im coming for you
i'm coming for you
coming to your house
im outside your house
i'm outside your house
see you at your house
you are dead meat
youre dead meat
i will beat you
ill beat you up
i'll beat you up
beat you up | s=1
beat the shit out of you
beat the crap out of you
kick your ass | s=1
whoop your ass | s=1
smash your face in
bash your head in
break your legs
break your neck
break every bone
snap your neck
i will stab you
ill stab you
i'll stab you
gonna stab you
stab you
i will shoot you
ill shoot you
i'll shoot you
gonna shoot you
shoot you in the head
put a bullet in you
cap your ass
i will strangle you
choke you out | s=2
slit your throat
cut your throat
cut your head off
chop your head off
behead you
gut you like a fish
skin you alive
burn you alive
burn your house down
burn down your house
set you on fire
i'll hurt you
ill hurt you
i will hurt you
make you suffer
you will suffer
i will end you
ill end you
i'll end you
i will destroy you | s=1
you won't see tomorrow
you wont see tomorrow
sleep with one eye open
your family is next
your kids are next
i'll kill your dog
kill your dog
kill your cat
i'll swat you
ill swat you
swat you
swatting you
gonna swat
i will dox you
ill dox you
i'll dox you
dox you
gonna dox
doxxing you
leak your address
leak your nudes | s=4
leak your face
@severity 5
shoot up the school
shoot up my school
shooting up the school
shoot up the mall
shoot up the church
shoot up the mosque
shoot up the synagogue
going to shoot up
gonna shoot up
bomb the school
blow up the school
blow myself up
i will blow up
kill everyone at
kill all of you
murder them all
genocide them
gas them all
lynch them
lynch him
lynch her
hang them all
string him up
string them up
@severity 4
kill all blacks
kill all whites
kill all jews
kill all muslims
kill all christians
kill all gays
kill all trans
kill all women
kill all men | s=3
kill all asians
kill all mexicans
kill all indians
kill all arabs
kill all immigrants
death to all
@severity 3
@match boundary
murder you
i'll smack you | s=2
ill smack you | s=2
punch your face in
punch you in the face | s=2
catch these hands | s=1
bullet in your skull
rope around your neck

@lang es
te voy a matar
te mato
voy a matarte
te voy a encontrar
se donde vives
te voy a partir la cara
te voy a romper la cara
te voy a pegar
te voy a violar | s=5
voy a quemar tu casa

@lang pt
vou te matar
eu vou te matar
sei onde voce mora
vou te bater
vou quebrar sua cara
voce vai morrer
vou te estuprar | s=5

@lang fr
je vais te tuer
je vais te buter
je te tue
je sais ou tu habites
je vais te frapper
je vais te casser la gueule
tu vas mourir
je vais te violer | s=5

@lang de
ich bring dich um
ich bringe dich um
ich töte dich
ich weiß wo du wohnst
ich weiss wo du wohnst
ich schlag dich
ich hau dich
ich stech dich ab
ich vergewaltige dich | s=5

@lang it
ti ammazzo
ti uccido
so dove abiti
ti spacco la faccia
ti violento | s=5

@lang tr
seni oldurecegim
öldürürüm seni
seni gebertirim
evini biliyorum
nerede oturduğunu biliyorum
seni döverim
kafanı kırarım

@lang hi
jaan se maar dunga
maar dalunga
tujhe maar dunga
tujhe maar dalunga
jaan le lunga
gaand tod dunga
teri maa ko maar dunga
ghar aake maarunga
ghar pe aake maarunga
tera ghar pata hai
kaat dunga
kaat ke rakh dunga
goli maar dunga
goli maar do

@lang ru
ya tebya ubyu
ubyu tebya
ya znayu gde ty zhivesh
tebe konets
tebe pizdec
я тебя убью
убью
тебе конец
`;
