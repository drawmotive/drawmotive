import assert from 'node:assert/strict';
import test from 'node:test';
import { projectSelection, selectionEdit, setModel, callModel } from '../src/react/selection-model.js';
const caps={stroke:true,fill:true,cornerRadius:true,editText:true,text:false,line:false,connectorRouting:false,group:false,groupTitle:false,verticalTextAlignment:false};
const shape=(id,role='PrimaryFill')=>({id,kind:'Shape',bindingItemId:null,textId:null,capabilities:{...caps},model:{data:{paintStyle:{color:{colorClass:'Foreground',colorValue:0xff123456},fillColor:{colorClass:role,colorValue:null},strokeWidth:{widthClass:'Normal',widthValue:null},strokeClass:'Solid'},cornerRadius:0}},resolved:{cornerRadius:0},screenBounds:{left:10,top:20,right:100,bottom:80}});
const selection=items=>({revision:'document:1',token:{session:'selection',version:4},items,anchor:null});

test('toolbar projection derives mixed values from generated model snapshots without mutating them',()=>{
 assert.equal(typeof projectSelection,'function');
 const snapshot=selection([shape('one'),shape('two','SecondaryFill')]);
 const view=projectSelection(snapshot);
 assert.equal(view.properties.fillColor.state,'Mixed');
 assert.deepEqual(view.properties.strokeColor,{state:'Uniform',value:{role:'Foreground',argb:0xff123456}});
 assert.equal(view.properties.cornerRadius.value,0);
 assert.equal(Object.hasOwn(snapshot,'properties'),false);assert.equal(Object.hasOwn(snapshot.items[0],'properties'),false);
});

test('bound-text focus uses resolved typography and retains explicit theme-default null values',()=>{
 assert.equal(typeof projectSelection,'function');
 const owner={...shape('owner'),kind:'Group',textId:'title',capabilities:{...caps,group:true,groupTitle:true},resolved:{cornerRadius:0,groupColorRole:null,groupHeaderVisible:false}};
 const title={...shape('title'),kind:'BoundText',bindingItemId:'owner',capabilities:{...caps,stroke:false,fill:false,text:true,verticalTextAlignment:true},model:{fontStyle:{size:{sizeClass:'GroupTitle',sizeValue:null},color:{colorClass:'GroupTitle',colorValue:null},weight:-1,slant:'Upright',textAlign:'Left',verticalTextAlign:'Top'}},resolved:{fontStyle:{size:{sizeValue:24},weight:700,slant:'Italic',textAlign:'Center',verticalTextAlign:'Bottom'}}};
 owner.boundText=title;
 const focus=projectSelection(selection([owner,title]));
 assert.deepEqual(focus.properties.bold,{state:'Uniform',value:true});
 assert.equal(focus.properties.resolvedTextSize.value,24);assert.equal(focus.properties.horizontalAlignment.value,'Center');
 const group=projectSelection(selection([owner]));
 assert.deepEqual(group.properties.groupColorRole,{state:'Uniform',value:null});
 assert.equal(group.properties.groupHeaderVisible.value,false);assert.equal(group.items[0].boundText.properties.italic.value,true);
});

test('unsupported mixed properties remain unavailable instead of treating absent values as uniform',()=>{
 assert.equal(typeof projectSelection,'function');
 const line={...shape('line'),kind:'Line',capabilities:{...caps,line:true,fill:false,cornerRadius:false},model:{...shape('line').model,startStyle:4,endStyle:1,routing:'Orthogonal'}};
 const view=projectSelection(selection([shape('one'),line]));
 assert.equal(view.properties.fillColor.state,'Unavailable');assert.equal(view.properties.lineStartStyle.state,'Unavailable');
 assert.equal(projectSelection(selection([line])).properties.lineRouting.value,'Straight');
});

test('one toolbar batch uses its observed revision and token for effective selection subjects',()=>{
 assert.equal(typeof selectionEdit,'function');
 const owner={...shape('owner'),textId:'label'};
 const text={...shape('label'),kind:'BoundText',bindingItemId:'owner',capabilities:{...caps,text:true,fill:false},model:{fontStyle:{weight:400}},resolved:{fontStyle:{weight:400}}};
 const view=projectSelection(selection([owner,text]));
 const edit=selectionEdit(view,'Format label',item=>[setModel(item,['fontStyle','weight'],700)]);
 assert.deepEqual(edit,{revision:'document:1',description:'Format label',token:{session:'selection',version:4},changes:[{itemId:'label',path:['fontStyle','weight'],value:700}]});
 assert.deepEqual(selectionEdit(view,'Reset title',item=>[callModel(item,'resetTitleStyle','All')],owner).changes,[{itemId:'owner',op:'call',path:['resetTitleStyle'],arguments:['All']}]);
});
