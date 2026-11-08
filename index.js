import 'react-native-get-random-values';
import { registerRootComponent } from 'expo';
import { Buffer } from 'buffer';

import App from './src/App';

// react-native-udp speaks in Buffers; RN has no global Buffer of its own.
global.Buffer = global.Buffer || Buffer;

registerRootComponent(App);
