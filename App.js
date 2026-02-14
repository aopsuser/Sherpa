import React, { useState, useRef, useEffect } from 'react';
import { 
  StyleSheet, View, SafeAreaView, Alert, StatusBar, TouchableOpacity, Keyboard, ScrollView
} from 'react-native';
import { WebView } from 'react-native-webview';
import ViewShot from 'react-native-view-shot';
import Voice from '@react-native-voice/voice';
import { 
  Provider as PaperProvider, MD3DarkTheme, TextInput, FAB, Text, ActivityIndicator, Surface, Badge, List, SegmentedButtons
} from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Zap, Globe, ChevronLeft, ChevronRight, RotateCw, Home, Bot, X, PauseCircle, BrainCircuit, GraduationCap, Eye, Code, Mic } from 'lucide-react-native';

const GEMINI_API_KEY = "GEMINI_API_KEY"; 

export default function AIWebAgentApp() {
  const [url, setUrl] = useState('https://www.google.com');
  const [inputUrl, setInputUrl] = useState('https://www.google.com');
  const [userCommand, setUserCommand] = useState('');
  const [currentGoal, setCurrentGoal] = useState(''); 
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [agentMode, setAgentMode] = useState('idle');
  const [analysisMode, setAnalysisMode] = useState('vision');
  const [selectedTab, setSelectedTab] = useState('auto'); 
  
  const [guidePrompt, setGuidePrompt] = useState(''); 
  const [stepCount, setStepCount] = useState(0); 
  const [isRecording, setIsRecording] = useState(false);
  
  const [learnedSkills, setLearnedSkills] = useState({}); 
  const [siteMaps, setSiteMaps] = useState({}); 
  const [currentSessionSteps, setCurrentSessionSteps] = useState([]); 
  const [showSkills, setShowSkills] = useState(false); 
  
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  
  const webViewRef = useRef(null);
  const viewShotRef = useRef(null);

  useEffect(() => { 
    loadKnowledgeBase(); 

    Voice.onSpeechStart = () => setIsRecording(true);
    Voice.onSpeechEnd = () => setIsRecording(false);
    Voice.onSpeechError = (e) => { console.error(e); setIsRecording(false); };
    Voice.onSpeechResults = (e) => {
        if (e.value && e.value.length > 0) {
            setUserCommand(e.value[0]);
            setTimeout(() => startAgent(e.value[0]), 500); 
        }
    };

    return () => {
        Voice.destroy().then(Voice.removeAllListeners);
    };
  }, []);

  const loadKnowledgeBase = async () => {
    try {
      const skills = await AsyncStorage.getItem('@agent_skills');
      const maps = await AsyncStorage.getItem('@agent_sitemaps');
      if (skills) setLearnedSkills(JSON.parse(skills));
      if (maps) setSiteMaps(JSON.parse(maps));
    } catch (e) { console.error(e); }
  };

  const saveSkill = async (goal, steps) => {
    try {
      const updatedSkills = { ...learnedSkills, [goal.toLowerCase()]: steps };
      setLearnedSkills(updatedSkills);
      await AsyncStorage.setItem('@agent_skills', JSON.stringify(updatedSkills));
      Alert.alert("Новый навык!", `Я запомнил как делать: "${goal}"`);
    } catch (e) { console.error(e); }
  };

  const saveSiteMap = async (url, elements) => {
    try {
      const domain = url.split('/')[2]; 
      if (!domain) return;
      const updatedMaps = { ...siteMaps, [domain]: elements.slice(0, 30) }; 
      setSiteMaps(updatedMaps);
      await AsyncStorage.setItem('@agent_sitemaps', JSON.stringify(updatedMaps));
    } catch (e) { console.error(e); }
  };

  const toggleVoiceRecording = async () => {
      if (isRecording) {
          await Voice.stop();
      } else {
          setUserCommand('');
          try { await Voice.start('ru-RU'); }
          catch (e) { console.error(e); }
      }
  };

  const startAgent = async (commandText) => {
    if (!commandText) return;
    Keyboard.dismiss();
    const goalKey = commandText.trim().toLowerCase();
    
    if (learnedSkills[goalKey]) {
        Alert.alert("Вспомнил!", "Я уже знаю как это делать. Выполнить из памяти?",
            [{ text: "Да", onPress: () => playMacro(learnedSkills[goalKey]) },
             { text: "Нет", onPress: () => startNavigation(commandText, selectedTab) }]
        );
        return;
    }
    startNavigation(commandText, selectedTab);
  };

  const startNavigation = (goal, mode) => {
    setCurrentGoal(goal); setAgentMode(mode); setStepCount(0); setGuidePrompt(''); setCurrentSessionSteps([]); 
    triggerAnalysis(goal);
  };

  const stopAgent = () => { setAgentMode('idle'); setLoading(false); setCurrentGoal(''); setGuidePrompt(''); };

  const playMacro = async (steps) => {
      setIsAiPanelOpen(false); setLoading(true); setAgentMode('auto');
      for (let i = 0; i < steps.length; i++) {
          if (steps[i].action === 'finish') break;
          executeAction(steps[i], true); 
          await new Promise(r => setTimeout(r, steps[i].action === 'navigate' ? 4000 : 2500));
      }
      setLoading(false); stopAgent(); Alert.alert("Макрос завершен");
  };

  const triggerAnalysis = (goal) => {
      if (agentMode === 'idle') return;
      setLoading(true);
      if (analysisMode === 'vision') {
          setTimeout(() => analyzeWithVision(goal), 800);
      } else {
          analyzeWithDOM(goal);
      }
  };

  const analyzeWithVision = async (goal) => {
    try {
        const uri = await viewShotRef.current.capture();
        
        const prompt = `
          ROLE: You are a Vision-based Autonomous Web Agent.
          GOAL: "${goal}".
          
          Look at the attached screenshot of the mobile web browser.
          Find the interactive element (button, link, input field) needed to progress towards the goal.
          
          INSTRUCTIONS:
          1. If the goal is fully achieved on this screen, return {"action": "finish"}.
          2. Otherwise, find the target element and return its approximate center coordinates.
          3. Normalize the coordinates to a 0-1000 scale, where (0,0) is the top-left corner, and (1000,1000) is the bottom-right corner.
          
          RETURN STRICTLY JSON ONLY:
          {"action": "click", "x": 500, "y": 150, "description": "Login button"}
          OR
          {"action": "type", "x": 500, "y": 300, "value": "test@mail.com", "description": "Email input"}
          OR
          {"action": "finish"}
        `;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: uri } }] }],
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
            })
        });

        const data = await response.json();
        const rawText = data.candidates[0].content.parts[0].text;
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) executeAction(JSON.parse(jsonMatch[0]), false, true);
        else stopAgent();
    } catch (error) {
        console.error("Vision Error:", error);
        setLoading(false);
    }
  };

  const analyzeWithDOM = (goal) => {
    const domCollectorScript = `
      (function() {
        const getAllInteractive = () => {
          const all = document.querySelectorAll('a, button, input, textarea, [role="button"], [onclick], span, div');
          const result = [];
          all.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10 || rect.top > window.innerHeight * 3) return;
            const text = (el.innerText || el.placeholder || el.value || el.ariaLabel || "").replace(/\\s+/g, ' ').trim();
            if (!text && el.tagName !== 'INPUT') return;
            if ((el.tagName === 'DIV' || el.tagName === 'SPAN') && text.length > 50) return;

            let selector = el.tagName.toLowerCase();
            if (el.id) selector += "#" + el.id;
            else if (el.className && typeof el.className === 'string' && el.className.trim() !== '') {
               selector += "." + el.className.trim().split(' ')[0];
            }
            result.push({ tag: el.tagName, text: text.substring(0, 60), selector: selector });
          });
          return result;
        };
        const pageData = { url: window.location.href, title: document.title, elements: getAllInteractive().slice(0, 100) };
        window.ReactNativeWebView.postMessage(JSON.stringify({type: 'DOM_DATA', payload: pageData, goal: "${goal}"}));
      })();
    `;
    webViewRef.current.injectJavaScript(domCollectorScript);
  };

  const processWithGeminiDOM = async (pageData, goal) => {
    saveSiteMap(pageData.url, pageData.elements);
    const domain = pageData.url.split('/')[2];
    const knownMap = siteMaps[domain] ? "I have visited this site before." : "New site.";

    const prompt = `
      ROLE: Autonomous Web Navigator. GOAL: "${goal}". URL: "${pageData.url}". Memory Note: ${knownMap}
      Elements: ${JSON.stringify(pageData.elements)}
      RETURN JSON ONLY: {"action": "navigate", "url": "..."} OR {"action": "finish"} OR {"selector": "css", "action": "click" | "type", "value": "text"}
    `;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
        })
      });
      const data = await response.json();
      const rawText = data.candidates[0].content.parts[0].text;
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) executeAction(JSON.parse(jsonMatch[0]), false, false); 
    } catch (e) { console.error(e); setLoading(false); }
  };

  const executeAction = (plan, isMacroPlayback = false, isVisionPlan = false) => {
    if (!isMacroPlayback) setCurrentSessionSteps(prev => [...prev, plan]);

    if (plan.action === 'finish') {
        Alert.alert("Готово!", plan.message || plan.description || "Цель достигнута.");
        if (!isMacroPlayback && currentGoal) saveSkill(currentGoal, [...currentSessionSteps, plan]);
        stopAgent();
        return;
    }

    if (plan.action === 'navigate') {
        setLoading(!isMacroPlayback); setUrl(plan.url); setInputUrl(plan.url); return;
    }

    let executionLogic = isVisionPlan ? `
        const actualX = (${plan.x} / 1000) * window.innerWidth;
        const actualY = (${plan.y} / 1000) * window.innerHeight;
        let el = document.elementFromPoint(actualX, actualY);
        if (el && !el.onclick && el.tagName !== 'BUTTON' && el.tagName !== 'A' && el.tagName !== 'INPUT') {
            el = el.closest('a, button, [role="button"], input') || el;
        }
    ` : `
        let el = document.querySelector('${plan.selector}');
        if (!el) {
            const allEls = Array.from(document.querySelectorAll('a, button, input, span, div'));
            el = allEls.find(e => e.innerText && e.innerText.includes("${plan.value || ''}"));
        }
    `;

    const script = `
      (function() {
        ${executionLogic}

        if (el) {
          el.scrollIntoView({behavior: "smooth", block: "center", inline: "center"});
          
          if ('${agentMode}' === 'guide' && !${isMacroPlayback}) {
              const oldOutline = el.style.outline; const oldBoxShadow = el.style.boxShadow;
              el.style.outline = "4px solid #00ff00"; el.style.boxShadow = "0 0 20px #00ff00";
              el.style.transition = "all 0.3s";
              
              ${isVisionPlan ? `
                const dot = document.createElement('div');
                dot.style.position = 'fixed'; dot.style.left = actualX + 'px'; dot.style.top = actualY + 'px';
                dot.style.width = '10px'; dot.style.height = '10px'; dot.style.backgroundColor = 'red';
                dot.style.borderRadius = '5px'; dot.style.zIndex = '999999'; dot.style.pointerEvents = 'none';
                document.body.appendChild(dot);
              ` : ''}

              let actionMsg = '${plan.action === 'click' ? 'Нажмите сюда' : `Введите текст: "${plan.value || ''}"`}';
              window.ReactNativeWebView.postMessage(JSON.stringify({type: 'GUIDE_PROMPT', message: actionMsg}));

              const handler = (e) => {
                  el.style.outline = oldOutline; el.style.boxShadow = oldBoxShadow;
                  ${isVisionPlan ? 'if(dot) dot.remove();' : ''}
                  el.removeEventListener('${plan.action === 'click' ? 'click' : 'input'}', handler);
                  window.ReactNativeWebView.postMessage(JSON.stringify({type: 'USER_ACTION_COMPLETED'}));
              };
              el.addEventListener('${plan.action === 'click' ? 'click' : 'input'}', handler);
              
          } else {
              setTimeout(() => {
                  if ('${plan.action}' === 'click') {
                    el.click(); el.focus();
                    el.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                    el.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                  } else {
                    el.value = "${plan.value}";
                    el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true}));
                    if (el.tagName === 'INPUT') el.form?.submit();
                  }
              }, 500); 
          }
        } else {
             window.ReactNativeWebView.postMessage(JSON.stringify({type: 'ELEMENT_NOT_FOUND'}));
        }
      })();
    `;
    
    webViewRef.current.injectJavaScript(script);
    if (!isMacroPlayback) setStepCount(prev => prev + 1);
    
    if (agentMode === 'auto' && !isMacroPlayback) {
        setLoading(true);
        setTimeout(() => { if (loading && agentMode === 'auto') triggerAnalysis(currentGoal); }, 5000);
    } else {
        setLoading(false); 
    }
  };

  const injectMutationObserver = () => {
    const observerScript = `
      (function() {
        if (window.__mutationObserverInjected) return;
        window.__mutationObserverInjected = true;
        
        let timeout;
        const observer = new MutationObserver((mutations) => {
            let shouldTrigger = false;
            for (let m of mutations) {
                if (m.addedNodes.length > 0) shouldTrigger = true; 
            }
            if (shouldTrigger) {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    window.ReactNativeWebView.postMessage(JSON.stringify({type: 'DOM_MUTATED'}));
                }, 1500);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      })();
    `;
    webViewRef.current.injectJavaScript(observerScript);
  };

  const handleMessage = (event) => {
    const data = JSON.parse(event.nativeEvent.data);
    
    if (data.type === 'DOM_DATA') { 
        processWithGeminiDOM(data.payload, data.goal); 
    } 
    else if (data.type === 'GUIDE_PROMPT') { 
        setGuidePrompt(data.message); 
    } 
    else if (data.type === 'USER_ACTION_COMPLETED') {
        setGuidePrompt(''); setLoading(true);
        setTimeout(() => { if (agentMode === 'guide') triggerAnalysis(currentGoal); }, 2000);
    }
    else if (data.type === 'ELEMENT_NOT_FOUND') {
        if (agentMode !== 'idle') setTimeout(() => triggerAnalysis(currentGoal), 2000);
    }
    else if (data.type === 'DOM_MUTATED') {
        if (agentMode === 'auto' && loading) {
            triggerAnalysis(currentGoal);
        }
    }
  };

  const handleLoadEnd = () => {
      injectMutationObserver();
      if (agentMode !== 'idle' && currentGoal) {
          setTimeout(() => triggerAnalysis(currentGoal), 1500);
      } else {
          setLoading(false);
      }
  };

  const getThemeColor = () => {
      if (agentMode === 'auto') return '#00ff00';
      if (agentMode === 'guide') return '#00aaff';
      return '#ffd700';
  };

  return (
    <PaperProvider theme={MD3DarkTheme}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <SafeAreaView style={styles.container}>
        
        <Surface style={styles.controlsHeader} elevation={2}>
          <View style={styles.urlBar}>
             <Globe size={20} color={getThemeColor()} style={{marginRight: 8}}/>
             <TextInput 
              mode="flat" value={inputUrl} onChangeText={setInputUrl} style={styles.urlInput}
              textColor="white" underlineColor="transparent" activeUnderlineColor="transparent"
              onSubmitEditing={() => setUrl(inputUrl.startsWith('http') ? inputUrl : `https://${inputUrl}`)}
            />
            {agentMode !== 'idle' && <Badge style={{backgroundColor: getThemeColor(), color: 'black'}}>{agentMode.toUpperCase()}</Badge>}
            
            <TouchableOpacity onPress={() => setShowSkills(!showSkills)} style={{marginLeft: 10}}>
                <BrainCircuit size={24} color={Object.keys(learnedSkills).length > 0 ? "#ffd700" : "#555"} />
            </TouchableOpacity>
          </View>
          
          {isAiPanelOpen && !showSkills && (
            <View style={styles.aiPanelContainer}>
              <View style={{flexDirection: 'row', gap: 10, marginBottom: 10}}>
                  <SegmentedButtons
                    value={selectedTab} onValueChange={setSelectedTab}
                    buttons={[
                      { value: 'auto', label: 'Сам', checkedColor: '#00ff00' },
                      { value: 'guide', label: 'Гид', checkedColor: '#00aaff' },
                    ]}
                    style={{flex: 1}}
                  />
                  <TouchableOpacity 
                      style={[styles.visionToggle, {borderColor: analysisMode === 'vision' ? '#ff00ff' : '#444'}]} 
                      onPress={() => setAnalysisMode(analysisMode === 'vision' ? 'dom' : 'vision')}
                  >
                      {analysisMode === 'vision' ? <Eye color="#ff00ff" /> : <Code color="#aaa" />}
                  </TouchableOpacity>
              </View>

              <TextInput 
                mode="outlined"
                label={agentMode !== 'idle' ? `Цель: ${currentGoal}` : "Что нужно сделать?"}
                value={userCommand} onChangeText={setUserCommand} style={styles.commandInput}
                placeholder="Например: Закажи пиццу"
                right={
                  <TextInput.Icon 
                    icon={() => agentMode !== 'idle' ? <PauseCircle size={24} color="red"/> : <Zap size={24} color={selectedTab === 'auto' ? '#00ff00' : '#00aaff'} />} 
                    onPress={() => agentMode !== 'idle' ? stopAgent() : startAgent(userCommand)} 
                  />
                }
                left={
                  <TextInput.Icon 
                    icon={() => <Mic size={24} color={isRecording ? "red" : "#aaa"} />} 
                    onPress={toggleVoiceRecording} 
                  />
                }
              />
            </View>
          )}

          {showSkills && (
              <View style={styles.skillsContainer}>
                  <Text style={styles.skillsTitle}>Память ({Object.keys(learnedSkills).length}):</Text>
                  <ScrollView style={{maxHeight: 150}}>
                      {Object.keys(learnedSkills).map((skill, index) => (
                          <List.Item key={index} title={skill} titleStyle={{color: 'white'}}
                              left={props => <List.Icon {...props} icon="play-circle" color="#00ff00" />}
                              onPress={() => playMacro(learnedSkills[skill])}
                          />
                      ))}
                  </ScrollView>
              </View>
          )}
        </Surface>

        <View style={styles.webWrapper}>
          <ViewShot ref={viewShotRef} options={{ format: "jpg", quality: 0.6, result: "base64" }} style={{ flex: 1 }}>
              <WebView 
                ref={webViewRef} source={{ uri: url }} style={styles.webview}
                onLoadStart={() => { setLoading(true); window.__mutationObserverInjected = false; }}
                onLoadEnd={handleLoadEnd}
                onNavigationStateChange={(navState) => {
                  setCanGoBack(navState.canGoBack); setCanGoForward(navState.canGoForward);
                  if (!navState.loading) setInputUrl(navState.url);
                }}
                onMessage={handleMessage} 
              />
          </ViewShot>
          
          {guidePrompt !== '' && (
              <View style={styles.guideBanner}>
                  <GraduationCap size={24} color="#00aaff" />
                  <Text style={styles.guideText}>{guidePrompt}</Text>
              </View>
          )}
          
          {loading && agentMode !== 'guide' && (
            <View style={styles.loaderOverlay}>
              <ActivityIndicator size="large" color={analysisMode === 'vision' ? '#ff00ff' : '#00ff00'} />
              <Text style={styles.loaderText}>{analysisMode === 'vision' ? 'Смотрю на экран...' : 'Думаю...'}</Text>
            </View>
          )}
        </View>

        <FAB icon={() => isAiPanelOpen ? <X size={24} color="black"/> : <Bot size={28} color="black"/>}
             style={[styles.fab, { backgroundColor: getThemeColor() }]}
             onPress={() => { setIsAiPanelOpen(!isAiPanelOpen); setShowSkills(false); }} />

        <Surface style={styles.bottomBar} elevation={4}>
          <View style={styles.navControls}>
             <TouchableOpacity disabled={!canGoBack} onPress={() => webViewRef.current.goBack()}><ChevronLeft size={28} color={canGoBack ? "white" : "#444"} /></TouchableOpacity>
             <TouchableOpacity disabled={!canGoForward} onPress={() => webViewRef.current.goForward()}><ChevronRight size={28} color={canGoForward ? "white" : "#444"} /></TouchableOpacity>
             <TouchableOpacity onPress={() => webViewRef.current.reload()}><RotateCw size={24} color="white" /></TouchableOpacity>
             <TouchableOpacity onPress={() => { stopAgent(); setUrl('https://www.google.com'); }}><Home size={24} color="#aaa" /></TouchableOpacity>
          </View>
        </Surface>
      </SafeAreaView>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  controlsHeader: { padding: 10, backgroundColor: '#1a1a1a', borderBottomWidth: 1, borderColor: '#333', zIndex: 10 },
  urlBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#333', borderRadius: 8, paddingHorizontal: 10, height: 40 },
  urlInput: { flex: 1, height: 40, backgroundColor: 'transparent', fontSize: 14, color: 'white' },
  aiPanelContainer: { marginTop: 10, paddingTop: 5, borderTopWidth: 1, borderTopColor: '#444' },
  commandInput: { backgroundColor: '#2a2a2a' },
  skillsContainer: { marginTop: 10, backgroundColor: '#222', borderRadius: 8, padding: 5 },
  skillsTitle: { color: '#ffd700', fontWeight: 'bold', padding: 10, fontSize: 14 },
  webWrapper: { flex: 1 }, webview: { flex: 1 },
  visionToggle: { padding: 10, borderWidth: 1, borderRadius: 20, justifyContent: 'center', alignItems: 'center', backgroundColor: '#222' },
  loaderOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  loaderText: { marginTop: 10, color: 'white', fontWeight: 'bold' },
  guideBanner: { position: 'absolute', top: 20, left: 20, right: 20, backgroundColor: '#111', borderColor: '#00ff00', borderWidth: 2, borderRadius: 12, padding: 15, flexDirection: 'row', alignItems: 'center', elevation: 5, zIndex: 200 },
  guideText: { color: 'white', fontSize: 16, fontWeight: 'bold', marginLeft: 10, flex: 1 },
  bottomBar: { backgroundColor: '#1e1e1e', flexDirection: 'row', alignItems: 'center', paddingVertical: 5, paddingHorizontal: 10, borderTopWidth: 1, borderColor: '#333' },
  navControls: { flexDirection: 'row', gap: 20, alignItems: 'center' },
  fab: { position: 'absolute', margin: 16, right: 0, bottom: 60, zIndex: 300 },
});