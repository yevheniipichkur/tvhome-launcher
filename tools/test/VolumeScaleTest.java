package pl.pichkur.tvhome;
public class VolumeScaleTest {
    public static void main(String[] args) {
        int checks=0;
        for(int max:new int[]{1,15,25,100}) {
            if(VolumeScale.percent(0,max,false)!=0 || VolumeScale.percent(max,max,false)!=100) throw new AssertionError("endpoints");
            int prev=-1;
            for(int v=0;v<=max;v++) { int p=VolumeScale.percent(v,max,false);if(p<prev||p>100||VolumeScale.percent(v,max,true)!=0)throw new AssertionError("monotonic/mute");prev=p;checks++; }
        }
        if(VolumeScale.percent(8,15,false)!=53 || VolumeScale.percent(7,15,false)!=47 || VolumeScale.percent(-1,15,false)!=0 || VolumeScale.percent(20,15,false)!=100 || VolumeScale.percent(8,0,false)!=0)throw new AssertionError("round/clamp");
        VolumeChangeTracker tracker = new VolumeChangeTracker(8, false);
        if(tracker.changed(8,false,false))throw new AssertionError("no initial popup");
        if(!tracker.changed(9,false,false))throw new AssertionError("firmware change displayed");
        if(tracker.changed(9,false,false))throw new AssertionError("duplicate suppressed");
        if(tracker.changed(10,false,true))throw new AssertionError("own command suppressed");
        if(tracker.changed(10,false,false))throw new AssertionError("own duplicate suppressed");
        if(!tracker.changed(10,true,false)||!tracker.changed(10,false,false))throw new AssertionError("mute/unmute shown without level change");
        System.out.println("Firmware volume tracker passed: initial/changed/duplicate/own/mute/unmute, no audio mutation.");
        System.out.println("Volume scale passed: "+checks+" stream steps, monotonic percentage, mute and clamping.");
    }
}
