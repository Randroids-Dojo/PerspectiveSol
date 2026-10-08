"""Render Perspective Sol's original, phase-aligned 48-second soundtrack stems.
Only Python's standard library is needed. ffmpeg encodes WAV stems into MP3.
"""
import math, random, wave, array, pathlib, subprocess
random.seed(27)
RATE=32000
DURATION=48
N=RATE*DURATION
ROOT=pathlib.Path(__file__).resolve().parents[1]
keys=array.array('f',[0])*N
depth=array.array('f',[0])*N
def note(dst,midi,start,duration,volume,kind):
    freq=440*2**((midi-69)/12)
    offset=round(start*RATE)
    count=round(duration*RATE)
    for j in range(count):
        t=j/RATE
        if kind=='key':
            env=(1-math.exp(-t*80))*math.exp(-t*2.1)*(1-t/duration)**2
            v=math.sin(2*math.pi*freq*t)+.23*math.sin(2*math.pi*freq*2.003*t)*math.exp(-t*3)+.08*math.sin(2*math.pi*freq*3*t)
        elif kind=='pad':
            env=math.sin(math.pi*t/duration)**1.5
            v=.6*math.sin(2*math.pi*freq*t)+.22*math.sin(2*math.pi*(freq*1.002)*t)+.13*math.sin(2*math.pi*freq*2*t)
        else:
            env=math.exp(-t*28)*(1-t/duration)
            v=math.sin(2*math.pi*(55+85*math.exp(-t*40))*t)*.7
        dst[(offset+j)%N]+=v*env*volume
        if kind=='key':
            for delay,gain in [(.23,.18),(.46,.1),(.71,.06)]:
                dst[(offset+j+round(delay*RATE))%N]+=v*env*volume*gain
chords=[[48,55,60,64],[45,52,57,60],[41,48,53,57],[43,50,55,62]]
melody=[76,79,81,79,74,72,76,79,81,84,81,79,76,74,72,67]
for bar in range(16):
    start=bar*3
    chord=chords[(bar//2)%4]
    for voice,midi in enumerate(chord):
        note(depth,midi,start,6,.032 if voice else .065,'pad')
    for beat in range(4):
        note(keys,chord[beat%4]+12,start+beat*.75,2.8,.10,'key')
    note(keys,melody[bar],start+.375,3.4,.12,'key')
    if bar%2==0: note(keys,melody[bar]-12,start+1.875,2.2,.055,'key')
    for beat in range(2):note(depth,0,start+beat*1.5,.35,.045,'pulse')
for name,data in [('sol-keys',keys),('sol-depth',depth)]:
    samples=array.array('h')
    for i,value in enumerate(data):
        # Stereo taps give the keys a natural room without hard panning.
        gain=2.5 if name=='sol-keys' else 2.0
        left=(value+data[(i-721)%N]*.11)*gain
        right=(value+data[(i-1103)%N]*.11)*gain
        samples.extend([round(max(-1,min(1,left))*32767),round(max(-1,min(1,right))*32767)])
    out=ROOT/'public'/'audio'/f'{name}.wav'
    with wave.open(str(out),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(RATE);w.writeframes(samples.tobytes())
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(out),'-codec:a','libmp3lame','-b:a','128k',str(out.with_suffix('.mp3'))],check=True)
    out.unlink()
print('Rendered two original, phase-aligned 48-second stems.')
