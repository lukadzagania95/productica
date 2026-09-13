import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker'))
from app import evaluate
class MetricTests(unittest.TestCase):
 def test_perfect(self):
  p=[{'boxes':[[0,0,10,10]],'labels':[1],'scores':[.9]}];t=[{'boxes':[[0,0,10,10]],'labels':[1]}];m=evaluate(p,t,[{'id':'1','name':'One'}]);self.assertEqual(m['map'],1);self.assertEqual(m['precision'],1);self.assertEqual(m['recall'],1)
 def test_wrong_class_confusion(self):
  p=[{'boxes':[[0,0,10,10]],'labels':[2],'scores':[.9]}];t=[{'boxes':[[0,0,10,10]],'labels':[1]}];m=evaluate(p,t,[{'id':'1','name':'One'},{'id':'2','name':'Two'}]);self.assertEqual(m['map'],0);self.assertEqual(m['confusion'][0][1],1)
 def test_duplicate_predictions_do_not_double_count(self):
  p=[{'boxes':[[0,0,10,10],[0,0,10,10]],'labels':[1,1],'scores':[.9,.8]}];t=[{'boxes':[[0,0,10,10]],'labels':[1]}];m=evaluate(p,t,[{'id':'1','name':'One'}]);self.assertEqual(m['precision'],.5);self.assertEqual(m['recall'],1);self.assertEqual(m['confusion'][1][0],1)
 def test_no_detections(self):
  m=evaluate([{'boxes':[],'labels':[],'scores':[]}],[{'boxes':[[0,0,10,10]],'labels':[1]}],[{'id':'1','name':'One'}]);self.assertEqual(m['map'],0);self.assertEqual(m['confusion'][0][1],1)
if __name__=='__main__':unittest.main()
