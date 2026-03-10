/**
 * Code originally from https://github.com/mrdoob/three.js/blob/master/examples/jsm/controls/PointerLockControls.js
 * 
 * Modified by firephrog to make sensitivity and keybinds customizable
 * 
*/

import {
	Euler,
	Vector3
} from 'three';

const _euler = new Euler( 0, 0, 0, 'YXZ' );
const _vector = new Vector3();
const _changeEvent = { type: 'change' };
const _lockEvent = { type: 'lock' };
const _unlockEvent = { type: 'unlock' };
const _MOUSE_SENSITIVITY = 0.002;
const _PI_2 = Math.PI / 2;


class PointerLockControls {
	constructor(camera, domElement = null) {
		this.object = camera;
		this.domElement = domElement;
		this.enabled = true;
		this.isLocked = false;
		this.minPolarAngle = 0;
		this.maxPolarAngle = Math.PI;
		this.pointerSpeed = 1.0;
		this.invertY = false;

		// event dispatcher shim
		this._listeners = {};

		this._onMouseMove = onMouseMove.bind(this);
		this._onPointerlockChange = onPointerlockChange.bind(this);
		this._onPointerlockError = onPointerlockError.bind(this);

		if (this.domElement !== null) {
		this.connect(this.domElement);
		}
	}

	addEventListener(type, fn)    { (this._listeners[type] ??= []).push(fn); }
	removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter(f => f !== fn); }
	dispatchEvent(e)              { (this._listeners[e.type] || []).forEach(fn => fn(e)); }

	connect(element) {
		this.domElement = element;
		element.ownerDocument.addEventListener('mousemove', this._onMouseMove);
		element.ownerDocument.addEventListener('pointerlockchange', this._onPointerlockChange);
		element.ownerDocument.addEventListener('pointerlockerror', this._onPointerlockError);
	}

	disconnect() {
		this.domElement.ownerDocument.removeEventListener('mousemove', this._onMouseMove);
		this.domElement.ownerDocument.removeEventListener('pointerlockchange', this._onPointerlockChange);
		this.domElement.ownerDocument.removeEventListener('pointerlockerror', this._onPointerlockError);
	}

	dispose() { this.disconnect(); }

	getDirection( v ) {
		return v.set( 0, 0, - 1 ).applyQuaternion( this.object.quaternion );
	}

	moveForward( distance ) {

		if ( this.enabled === false ) return;

		const camera = this.object;
		_vector.setFromMatrixColumn( camera.matrix, 0 );
		_vector.crossVectors( camera.up, _vector );
		camera.position.addScaledVector( _vector, distance );

	}

	moveRight( distance ) {

		if ( this.enabled === false ) return;
		const camera = this.object;
		_vector.setFromMatrixColumn( camera.matrix, 0 );
		camera.position.addScaledVector( _vector, distance );

	}

	lock(unadjustedMovement = false) {
		try {
			this.domElement.requestPointerLock({ unadjustedMovement });
		} catch {
			try {
			this.domElement.requestPointerLock();
			} catch(e) {
			// still in cooldown, ignore silently
			}
		}
	}

	unlock() {

		this.domElement.ownerDocument.exitPointerLock();

	}

}

// event listeners
function onMouseMove( event ) {

	if ( this.enabled === false || this.isLocked === false ) return;
	const invert = this.invertYAxis ? -1 : 1;

	const camera = this.object;
	_euler.setFromQuaternion( camera.quaternion );
	_euler.y -= event.movementX * _MOUSE_SENSITIVITY * this.pointerSpeed;
	_euler.x -= event.movementY * _MOUSE_SENSITIVITY * this.pointerSpeed * invert;
	_euler.x = Math.max( _PI_2 - this.maxPolarAngle, Math.min( _PI_2 - this.minPolarAngle, _euler.x ) );
	camera.quaternion.setFromEuler( _euler );
	this.dispatchEvent( _changeEvent );

}

function onPointerlockChange() {
	if ( this.domElement.ownerDocument.pointerLockElement === this.domElement ) {
		this.dispatchEvent( _lockEvent );
		this.isLocked = true;
	} else {
		this.dispatchEvent( _unlockEvent );
		this.isLocked = false;
	}
}

function onPointerlockError() {
	console.error( 'THREE.PointerLockControls: Unable to use Pointer Lock API' );
}

export { PointerLockControls };